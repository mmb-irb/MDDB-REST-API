// In a test environment 'mddb-database' gets its mongo connection from this module, so fake it
// Every reference collection finds the same references whatever the query, since we only check the translation
// The queries sent to reference collections are kept, to check which fields they search
const mockReferenceQueries = [];
jest.mock('mddb-database/utils/fake-mongo', () => {
  const references = {
    references: [{ uniprot: 'Q9BYF1' }],
    pdb_refs: [{ id: '6M0J' }],
    inchikey_refs: [{ inchikey: 'HVYWMOMLDIMFJA-DPAQBDIFSA-N' }],
  };
  const collection = name => ({
    find: query => {
      mockReferenceQueries.push({ collection: name, query });
      return { project: () => ({ map: getId => ({ toArray: async () => references[name].map(getId) }) }) };
    },
    countDocuments: async () => 0,
  });
  return Promise.resolve({ db: () => ({ collection }) });
});

const getDatabase = require('.');
const { BAD_REQUEST } = require('../utils/status-codes');

// Process the filter argument and return the processed queries, or the error
const processFilter = async filter => {
  const database = await getDatabase({ get: () => 'localhost' });
  return database.processProjectsFilter(filter);
};

describe('processProjectsFilter', () => {
  test('returns no queries when there is no filter', async () => {
    expect(await processFilter(undefined)).toEqual([]);
  });

  test('accepts both aliases and full paths', async () => {
    expect(await processFilter("type=eq='ensemble'")).toEqual([{ 'metadata.TYPE': 'ensemble' }]);
    expect(await processFilter("metadata.TYPE=eq='ensemble'")).toEqual([{ 'metadata.TYPE': 'ensemble' }]);
  });

  test('parses values according to the field type', async () => {
    expect(await processFilter(['temperature=ge=300', 'systemAtoms=lt=1000', 'published=eq=true', 'created=gt=2024-01-01']))
      .toEqual([
        { 'metadata.TEMP': { $gte: 300 } },
        { 'metadata.SYSTATS': { $lt: 1000 } },
        { published: true },
        { creationDate: { $gt: new Date('2024-01-01') } },
      ]);
  });

  test('supports several values, text search and negations', async () => {
    expect(await processFilter(["author=eq='A','B'", "name=ct='spike'", "program=ne='Amber'", "group=nc='orozco','irb'"]))
      .toEqual([
        { 'metadata.AUTHORS': { $in: ['A', 'B'] } },
        { 'metadata.NAME': { $regex: 'spike', $options: 'i' } },
        { $nor: [{ 'metadata.PROGRAM': 'Amber' }] },
        { $nor: [{ 'metadata.GROUPS': { $regex: 'orozco|irb', $options: 'i' } }] },
      ]);
  });

  test('translates reference fields into project fields', async () => {
    expect(await processFilter(["uniprotOrganism=eq='Homo sapiens'", "references.pdbs.title=ct='spike'", "uniprotGene=ne='ACE2'"]))
      .toEqual([
        { 'metadata.REFERENCES': { $in: ['Q9BYF1'] } },
        { 'metadata.PDBIDS': { $in: ['6M0J'] } },
        { 'metadata.REFERENCES': { $nin: ['Q9BYF1'] } },
      ]);
  });

  test('joins several conditions, including reference fields, matched if any matches', async () => {
    expect(await processFilter("uniprotOrganism=eq='Homo sapiens'; uniprotGene=ne='ACE2'; type=eq='ensemble'"))
      .toEqual([{ $or: [
        { 'metadata.REFERENCES': { $in: ['Q9BYF1'] } },
        { 'metadata.REFERENCES': { $nin: ['Q9BYF1'] } },
        { 'metadata.TYPE': 'ensemble' },
      ] }]);
  });

  test('searches nested fields of the references', async () => {
    mockReferenceQueries.length = 0;
    expect(await processFilter("references.inchikeys.ligand.name=eq='cholesterol'"))
      .toEqual([{ 'metadata.INCHIKEYS': { $in: ['HVYWMOMLDIMFJA-DPAQBDIFSA-N'] } }]);
    expect(mockReferenceQueries).toEqual([{ collection: 'inchikey_refs', query: { 'ligand.name': 'cholesterol' } }]);
  });

  test('rejects unknown references', async () => {
    expect((await processFilter("references.foo.bar=eq='x'")).headerError).toBe(BAD_REQUEST);
  });

  test('rejects mongo operators and objects', async () => {
    expect((await processFilter('$where=eq=1')).headerError).toBe(BAD_REQUEST);
    expect((await processFilter('metadata.$where=eq=1')).headerError).toBe(BAD_REQUEST);
    expect((await processFilter({ $ne: 'x' })).headerError).toBe(BAD_REQUEST);
    expect((await processFilter('{"metadata.TYPE":"ensemble"}')).headerError).toBe(BAD_REQUEST);
  });
});
