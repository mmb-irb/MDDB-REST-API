const pickFields = require('.');

const project = {
  accession: 'A0001',
  metadata: { NAME: 'Test', AUTHORS: ['a'], LICENSE: 'MIT' },
  mds: [{ name: 'one', frames: 1 }, { name: 'two', frames: 2 }],
  analyses: ['rmsd'],
};

describe('pickFields', () => {
  test('picks top level and nested fields', () => {
    expect(pickFields(project, ['accession', 'metadata.NAME', 'metadata.AUTHORS']))
      .toEqual({ accession: 'A0001', metadata: { NAME: 'Test', AUTHORS: ['a'] } });
  });

  test('picks whole objects and arrays', () => {
    expect(pickFields(project, ['metadata', 'analyses'])).toEqual({ metadata: project.metadata, analyses: ['rmsd'] });
  });

  test('traverses arrays', () => {
    expect(pickFields(project, ['mds.name'])).toEqual({ mds: [{ name: 'one' }, { name: 'two' }] });
    expect(pickFields(project, ['mds.name', 'mds.frames'])).toEqual({ mds: project.mds });
  });

  test('skips missing fields and does not modify the source', () => {
    expect(pickFields(project, ['pdbId', 'metadata.NOPE', 'accession.deep'])).toEqual({});
    expect(project.metadata.LICENSE).toBe('MIT');
  });
});
