const { REFERENCES } = require('mddb-database/utils/constants');
const { MAX_CHARS } = require('./api');
const { isEmpty } = require('./projects');

// The reference types the references and pointers endpoints look up
const REFERENCE_TYPES = Object.keys(REFERENCES);

// Per-residue PDBe data, 2D structures, fingerprints and descriptors, which make up most of a reference and the
// model rarely needs
const OMITTED_FIELDS = new Set([
  'knowledge', 'uni2pdb', 'mol_block', 'morgan_fp_bit_array', 'morgan_highlight_atoms', 'mordred',
]);

// The InterPro entries InterProScan found in a chain sequence, with where they are
const interproEntries = interproscan => {
  const entries = new Map();
  for (const match of interproscan?.results?.flatMap(result => result.matches ?? []) ?? []) {
    const { entry, accession, signatureLibraryRelease } = match.signature ?? {};
    if (!entry) continue;
    if (!entries.has(entry.accession)) {
      entries.set(entry.accession, { accession: entry.accession, name: entry.description ?? entry.name, type: entry.type,
        signatures: [], locations: [] });
    }
    const merged = entries.get(entry.accession);
    merged.signatures.push(`${signatureLibraryRelease?.library}:${accession}`);
    for (const { start, end } of match.locations ?? []) merged.locations.push(`${start}-${end}`);
  }
  return [...entries.values()].map(entry => ({ ...entry, locations: [...new Set(entry.locations)].join(', ') }));
};

// Leave out empty values and bulk data at any depth, and summarize the InterProScan results
const compact = value => {
  if (Array.isArray(value)) return value.map(compact);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === 'interproscan') return [['interpro', interproEntries(item)]];
    return OMITTED_FIELDS.has(key) || isEmpty(item) ? [] : [[key, compact(item)]];
  }));
};

const getReferences = async (api, { accession, type, id }) => {
  if (type && id) return compact(await api(`references/${type}/${encodeURIComponent(id)}`));
  if (!accession) throw new Error('Pass either an accession, or a reference type and id');
  const references = compact(await api(`projects/${encodeURIComponent(accession)}/references`));
  const length = JSON.stringify(references).length;
  if (length > MAX_CHARS) {
    // Old ligand references are identified by their PubChem id
    const ids = references.map(ref => `${ref.ref_type} ${ref.uniprot ?? ref.inchikey ?? ref.id ?? ref.sequence ?? ref.pubchem}`);
    throw new Error(`The references are ${length} characters long. Get them one by one with type and id: ${ids.join(', ')}`);
  }
  return references;
};

// Simulations in this database and, from the global API, in other MD databases
const findSimulations = async (api, { type, id, limit = 50, page = 1 }) => {
  const pointers = await api(`pointers/${type}/${encodeURIComponent(id)}`, { projection: 'metadata.NAME' });
  const sources = {};
  // API links are left out: MDDB projects are read through the other tools
  const simulations = pointers.map(({ id, web, api: _apiUrl, 'metadata.NAME': name, ...rest }) => {
    // The API only gives each simulation's links, so its database is the host of its web page
    const source = web ? new URL(web).hostname : undefined;
    if (source) sources[source] = (sources[source] ?? 0) + 1;
    return { id, source, name, web, ...rest };
  });
  return { total: simulations.length, sources, page, limit, simulations: simulations.slice((page - 1) * limit, page * limit) };
};

module.exports = { REFERENCE_TYPES, getReferences, findSimulations };
