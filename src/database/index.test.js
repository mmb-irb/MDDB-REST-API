// In a test environment 'mddb-database' gets its mongo connection from this module, so fake it
// Every reference collection finds the same references whatever the query, since we only check the translation
jest.mock('mddb-database/utils/fake-mongo', () => {
  const references = {
    references: [{ uniprot: 'Q9BYF1' }],
    pdb_refs: [{ id: '6M0J' }],
  };
  const collection = name => ({
    find: () => ({ project: () => ({ map: getId => ({ toArray: async () => references[name].map(getId) }) }) }),
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
    expect(await processFilter('type==ensemble')).toEqual([{ 'metadata.TYPE': 'ensemble' }]);
    expect(await processFilter('metadata.TYPE==ensemble')).toEqual([{ 'metadata.TYPE': 'ensemble' }]);
  });

  test('parses values according to the field type', async () => {
    expect(await processFilter(['temperature>=300', 'systemAtoms<1000', 'published==true', 'created>2024-01-01']))
      .toEqual([
        { 'metadata.TEMP': { $gte: 300 } },
        { 'metadata.SYSTATS': { $lt: 1000 } },
        { published: true },
        { creationDate: { $gt: new Date('2024-01-01') } },
      ]);
  });

  test('supports several values, text search and negations', async () => {
    expect(await processFilter(['author==A|B', 'name~=spike', 'program!=Amber', 'group!~=orozco|irb']))
      .toEqual([
        { 'metadata.AUTHORS': { $in: ['A', 'B'] } },
        { 'metadata.NAME': { $regex: 'spike', $options: 'i' } },
        { $nor: [{ 'metadata.PROGRAM': 'Amber' }] },
        { $nor: [{ 'metadata.GROUPS': { $regex: 'orozco|irb', $options: 'i' } }] },
      ]);
  });

  test('translates reference fields into project fields', async () => {
    expect(await processFilter(['uniprotOrganism==Homo sapiens', 'references.pdbs.title~=spike', 'uniprotGene!=ACE2']))
      .toEqual([
        { 'metadata.REFERENCES': { $in: ['Q9BYF1'] } },
        { 'metadata.PDBIDS': { $in: ['6M0J'] } },
        { 'metadata.REFERENCES': { $nin: ['Q9BYF1'] } },
      ]);
  });

  test('rejects unknown references', async () => {
    expect((await processFilter('references.foo.bar==x')).headerError).toBe(BAD_REQUEST);
  });

  test('rejects mongo operators and objects', async () => {
    expect((await processFilter('$where==1')).headerError).toBe(BAD_REQUEST);
    expect((await processFilter('metadata.$where==1')).headerError).toBe(BAD_REQUEST);
    expect((await processFilter({ $ne: 'x' })).headerError).toBe(BAD_REQUEST);
    expect((await processFilter('{"metadata.TYPE":"ensemble"}')).headerError).toBe(BAD_REQUEST);
  });
});
