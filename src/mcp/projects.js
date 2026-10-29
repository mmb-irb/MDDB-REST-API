const { QUERY_FIELDS } = require('mddb-database/utils/constants');
const { splitQuery } = require('./api');

// One line per field the API knows how to query, from the same definitions the API and the loader use
// Older mddb-database versions have no descriptions, and generic examples (e.g. "any number") add nothing
const fieldCatalog = fields => fields
  .map(({ path, type, name, description, example }) =>
    `${path} (${type}): ${description ?? name}` + (example.startsWith('any ') ? '' : ` E.g. ${example}`))
  .join('\n');
const FIELD_CATALOG = fieldCatalog(QUERY_FIELDS);

const SEARCH_PROJECTION = [
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
  return numbers.length ? numbers.reduce((a, b) => a + b, 0) : undefined;
};

// Top-level fields a query filters on. Fields inside $or and references.* fields are left out
const queriedFields = query => Object.entries(query).flatMap(([key, value]) => {
  if (key === '$and' && Array.isArray(value)) return value.flatMap(queriedFields);
  return key.startsWith('$') || key.startsWith('references.') ? [] : [key];
});

// Count projects in the whole database without each field, since nodes uploaded with older workflows lack some
const countMissing = async (api, fields) => {
  const counts = await Promise.all(fields.map(async field => {
    const response = await api('projects', {
      query: JSON.stringify({ [field]: { $exists: false } }),
      projection: '{"accession":1}',
      limit: 1,
    });
    return [field, response.filteredCount];
  }));
  const missing = counts.filter(([, count]) => count > 0);
  return missing.length ? Object.fromEntries(missing) : undefined;
};

const searchProjects = async (api, { text, query = {}, fields = [], sort, limit = 10, page = 1 }) => {
  const projection = Object.fromEntries([...SEARCH_PROJECTION, ...fields].map(field => [field, 1]));
  const [response, missingFields] = await Promise.all([
    api('projects', {
      search: text,
      query: splitQuery(query),
      projection: JSON.stringify(projection),
      sort: sort && JSON.stringify(sort),
      limit,
      page,
    }),
    countMissing(api, [...new Set(queriedFields(query))]),
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
      fields: fields.length ? Object.fromEntries(fields.map(field => [field, getPath(project, field.split('.'))])) : undefined,
    };
  });
  return { total: response.filteredCount, page, limit, missingFields, projects };
};

const projectOptions = async (api, { fields, text, query = {}, top = 30 }) => {
  const queries = splitQuery(query);
  // Without a query the API answers from precounted totals, which lag behind the stored projects
  const response = await api('projects/options', { projection: fields, search: text, query: queries.length ? queries : '{}' });
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
    // Older uploads store the protein sequences twice
    !(key === 'SEQUENCES' && JSON.stringify(value) === JSON.stringify(project.metadata.PROTSEQ)));
  return Object.fromEntries(Object.entries({ ...project, metadata: Object.fromEntries(metadata) })
    .filter(([key, value]) => !SKIPPED_FIELDS.has(key) && !isEmpty(value)));
};

module.exports = { fieldCatalog, FIELD_CATALOG, searchProjects, projectOptions, isEmpty, getProject };
