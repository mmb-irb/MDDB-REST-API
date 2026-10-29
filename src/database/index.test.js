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

// Process a single query and return the processed query, or the error
const processQuery = async query => {
  const database = await getDatabase({ get: () => 'localhost' });
  const processed = await database.processProjectsQuery(JSON.stringify(query));
  return processed.error ? processed : processed[0];
};

// The project fields which reference fields are translated to
const PROTEIN = { 'metadata.REFERENCES': { $in: ['Q9BYF1'] } };
const PDB = { 'metadata.PDBIDS': { $in: ['6M0J'] } };

describe('processProjectsQuery', () => {
  test('translates reference fields after other fields', async () => {
    const expected = { 'metadata.TYPE': 'trajectory', ...PROTEIN };
    expect(await processQuery({ 'references.proteins.gene': 'ACE2', 'metadata.TYPE': 'trajectory' }))
      .toEqual(expected);
    expect(await processQuery({ 'metadata.TYPE': 'trajectory', 'references.proteins.gene': 'ACE2' }))
      .toEqual(expected);
  });

  test('translates reference fields inside and after $and and $or', async () => {
    expect(await processQuery({
      $and: [{ 'metadata.TYPE': 'trajectory' }, { 'references.proteins.gene': 'ACE2' }],
      $or: [{ 'metadata.TYPE': 'trajectory', 'references.pdbs.title': 'SPIKE' }],
      'references.pdbs.title': 'SPIKE',
    })).toEqual({
      $and: [{ 'metadata.TYPE': 'trajectory' }, PROTEIN],
      $or: [{ 'metadata.TYPE': 'trajectory', ...PDB }],
      ...PDB,
    });
  });

  // The fake finds the same protein for every proteins field, but each condition must be kept
  test('keeps every condition on the same project field', async () => {
    expect(await processQuery({ 'references.proteins.gene': 'ACE2', 'references.proteins.name': 'Spike glycoprotein' }))
      .toEqual({ ...PROTEIN, $and: [PROTEIN] });
    expect(await processQuery({
      $and: [{ 'metadata.TYPE': 'trajectory' }],
      'metadata.REFERENCES': 'P0DTC2',
      'references.proteins.gene': 'ACE2',
    })).toEqual({
      $and: [{ 'metadata.TYPE': 'trajectory' }, PROTEIN],
      'metadata.REFERENCES': 'P0DTC2',
    });
  });

  test('parses dates after other fields, inside $and and after $and', async () => {
    expect(await processQuery({ 'metadata.TYPE': 'trajectory', updateDate: { $gt: '2024-01-01' } }))
      .toEqual({ 'metadata.TYPE': 'trajectory', updateDate: { $gt: new Date('2024-01-01') } });
    expect(await processQuery({
      $and: [{ 'metadata.TYPE': 'trajectory', updateDate: '2024-01-01' }],
      updateDate: { $lt: '2025-01-01' },
    })).toEqual({
      $and: [{ 'metadata.TYPE': 'trajectory', updateDate: new Date('2024-01-01') }],
      updateDate: { $lt: new Date('2025-01-01') },
    });
  });

  test('rejects unknown references', async () => {
    expect((await processQuery({ 'references.foo.bar': 'x' })).headerError).toBe(BAD_REQUEST);
    expect((await processQuery({ $or: [{ 'references.foo.bar': 'x' }] })).headerError).toBe(BAD_REQUEST);
  });
});
