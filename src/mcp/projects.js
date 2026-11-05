const { QUERY_FIELDS } = require('mddb-database/utils/constants');
const { parseFilters, resolveField } = require('mddb-database/utils/query-fields');
const { MAX_CHARS } = require('./api');
const { round } = require('./analyses');

// One line per field the API knows how to query, from the same definitions the API and the loader use
// Fields may be filtered by their alias or by their path
// Some fields have no description, and generic examples (e.g. "any number") add nothing
const fieldCatalog = fields => fields
  .map(({ alias, path, type, name, description, example }) =>
    `${alias} = ${path} (${type}): ${description ?? name}` + (example.startsWith('any ') ? '' : ` E.g. ${example}`))
  .join('\n');
const FIELD_CATALOG = fieldCatalog(QUERY_FIELDS);

const SEARCH_RETURN = [
  'accession', 'node', 'metadata.NAME', 'metadata.TYPE', 'metadata.SYSKEYS', 'metadata.SYSTATS',
  'metadata.PDBIDS', 'metadata.REFERENCES', 'mds.name', 'mds.frames', 'mds.time',
];

// Read a dotted path, mapping over arrays on the way (e.g. mds.frames gives one value per MD)
const getPath = (value, path) => {
  if (path.length === 0 || value == null) return value;
  if (Array.isArray(value)) return value.map(item => getPath(item, path));
  return getPath(value[path[0]], path.slice(1));
};

const sum = values => {
  const numbers = values.filter(value => typeof value === 'number');
  return numbers.length ? round(numbers.reduce((a, b) => a + b, 0)) : undefined;
};

// A requested parent (e.g. metadata) replaces its fields, since the API refuses to return both
const returnedPaths = paths => paths.filter(path => !paths.some(other => path.startsWith(other + '.')));

// Paths of the fields the filters are on, parsed as the API parses them. references.* fields are left out
// Wrong filters are reported here with the same message the API would answer
const filteredFields = filters => {
  const parsedFilters = parseFilters(filters);
  if (parsedFilters.error) throw new Error(parsedFilters.error);
  return parsedFilters.flat().map(condition => condition.path).filter(path => !path.startsWith('references.'));
};

// Paths of the extra fields, which may also be given by their alias, as the API returns them under their path
const fieldPaths = fields => fields.map(field => {
  const resolved = resolveField(field);
  if (resolved.error) throw new Error(resolved.error);
  return resolved.path;
});

// Count projects in the whole database with no value in each field, since nodes uploaded with older workflows lack some
// Note that an empty value in a filter stands for fields with no value: missing, null or an empty list
const countMissing = async (api, fields) => {
  const counts = await Promise.all(fields.map(async field => {
    const response = await api('projects', { filter: `${field}=eq=`, return: 'accession', limit: 1 });
    return [field, response.filteredCount];
  }));
  const missing = counts.filter(([, count]) => count > 0);
  return missing.length ? Object.fromEntries(missing) : undefined;
};

const searchProjects = async (api, { text, filters = [], fields = [], sort, limit = 10, page = 1 }) => {
  // Parse the filters and fields first, so wrong ones are refused before any request
  const missingCandidates = [...new Set(filteredFields(filters))];
  const paths = fieldPaths(fields);
  const [response, missingFields] = await Promise.all([
    api('projects', {
      search: text,
      filter: filters,
      return: returnedPaths([...SEARCH_RETURN, ...paths]),
      sort: sort && JSON.stringify(sort),
      limit,
      page,
    }),
    countMissing(api, missingCandidates),
  ]);
  const projects = response.projects.map(project => {
    const metadata = project.metadata ?? {};
    const mds = project.mds ?? [];
    return {
      accession: project.accession,
      node: project.node,
      name: metadata.NAME,
      type: metadata.TYPE,
      keywords: metadata.SYSKEYS,
      atoms: metadata.SYSTATS,
      mds: mds.length,
      frames: sum(mds.map(md => md.frames)),
      timeNs: sum(mds.map(md => md.time)),
      pdb: metadata.PDBIDS,
      uniprot: metadata.REFERENCES,
      fields: fields.length
        ? Object.fromEntries(fields.map((field, index) => [field, getPath(project, paths[index].split('.'))]))
        : undefined,
    };
  });
  const result = { total: response.filteredCount, page, limit, missingFields, projects };
  const length = JSON.stringify(result).length;
  if (length > MAX_CHARS) throw new Error(`The result is ${length} characters long. Ask for fewer fields or a smaller limit`);
  return result;
};

// Note that without text or filters the API answers from precounted totals
// These are updated by the loader and the monitor every time projects change
const projectOptions = async (api, { fields, text, filters = [], top = 30 }) => {
  let response;
  try {
    response = await api('projects/options', { return: fields, search: text, filter: filters });
  } catch (error) {
    // The API answers 404 when no project matches the filters
    if (error.status !== 404) throw error;
    return Object.fromEntries(fields.map(field => [field, { values: [] }]));
  }
  // Pairs rather than an object: JS would reorder integer-like values such as temperatures
  return Object.fromEntries(Object.entries(response).map(([field, counts]) => {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const rest = sorted.slice(top);
    return [field, {
      values: sorted.slice(0, top),
      otherValues: rest.length || undefined,
      otherCount: sum(rest.map(([, count]) => count)),
    }];
  }));
};

// Viewer setup, internal ids and duplicates of other fields
const SKIPPED_FIELDS = new Set(['_id', 'internalId', 'identifier']);
const SKIPPED_METADATA = new Set([
  'ORIENTATION', 'CUSTOMS', 'PBC_SELECTION', 'CG_SELECTION', 'ATNAME', 'ver', 'atomCount', 'frameCount',
]);

const isEmpty = value => value === null || value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && Object.keys(value).length === 0);

// Every stored field passes through except the ones above, so fields from any workflow version are kept
const getProject = async (api, accession) => {
  const project = await api(`projects/${encodeURIComponent(accession)}`);
  const metadata = Object.entries(project.metadata ?? {}).filter(([key, value]) =>
    !SKIPPED_METADATA.has(key) && !isEmpty(value) && value !== 0 &&
    // Older uploads also store the sequences in SEQUENCES, with placeholder chains (e.g. thousands of X for a
    // membrane), so only projects without PROTSEQ keep them
    !(key === 'SEQUENCES' && project.metadata.PROTSEQ));
  return Object.fromEntries(Object.entries({ ...project, metadata: Object.fromEntries(metadata) })
    .filter(([key, value]) => !SKIPPED_FIELDS.has(key) && !isEmpty(value)));
};

module.exports = { fieldCatalog, FIELD_CATALOG, searchProjects, projectOptions, isEmpty, getProject };
