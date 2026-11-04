const { FIELD_CATALOG, fieldCatalog, getProject, projectOptions, searchProjects } = require('./projects');

// Answers /projects searches with `projects`, and $exists:false counts from `missing`
const fakeApi = (projects, missing = {}) => jest.fn(async (_path, params = {}) => {
  const { query } = params;
  if (typeof query === 'string' && query.includes('"$exists":false')) {
    return { filteredCount: missing[Object.keys(JSON.parse(query))[0]] ?? 0, projects: [] };
  }
  return { filteredCount: 1234, projects };
});

describe('fieldCatalog', () => {
  it('lists the fields from mddb-database, including the sequences', () => {
    expect(FIELD_CATALOG).toContain('metadata.PROTSEQ (string): ');
    expect(FIELD_CATALOG).toContain('metadata.NUCLSEQ (string): ');
  });

  it('describes each field, or names it with older mddb-database versions, and leaves out generic examples', () => {
    expect(fieldCatalog([
      { name: 'Temperature (K)', path: 'metadata.TEMP', description: 'Temperature in Kelvin (K).', type: 'float', example: '300' },
      { name: 'Protein sequence', path: 'metadata.PROTSEQ', type: 'string', example: 'VNLTTRT' },
      { name: 'System atom count', path: 'metadata.SYSTATS', type: 'int', example: 'any integer number' },
    ])).toBe([
      'metadata.TEMP (float): Temperature in Kelvin (K). E.g. 300',
      'metadata.PROTSEQ (string): Protein sequence E.g. VNLTTRT',
      'metadata.SYSTATS (int): System atom count',
    ].join('\n'));
  });
});

describe('searchProjects', () => {
  const project = {
    accession: 'MD-A001SU',
    node: 'mmb',
    metadata: { NAME: 'Envelope protein E', TYPE: 'trajectory', SYSKEYS: ['protein', 'membrane'], SYSTATS: 51495,
      PDBIDS: [], REFERENCES: ['P0DTC4'], FF: ['CHARMM36m'] },
    mds: [{ name: 'replica 1', frames: 5001, time: 15003 }, { name: 'replica 2', frames: 5001, time: 15003 }],
  };

  it('splits the query, adds extra fields to the projection, and sums frames and time over MDs', async () => {
    const api = fakeApi([project]);
    const result = await searchProjects(api, { query: { 'metadata.TYPE': 'trajectory', 'references.proteins.gene': 'E' },
      fields: ['metadata.FF', 'mds.name'], limit: 5 });
    const params = api.mock.calls.find(([, p]) => !String(p?.query).includes('$exists'))[1];
    expect(params.query).toEqual(['{"metadata.TYPE":"trajectory"}', '{"references.proteins.gene":"E"}']);
    expect(JSON.parse(String(params.projection))).toMatchObject({ 'metadata.FF': 1, 'mds.name': 1, accession: 1 });
    expect(result).toEqual({
      total: 1234, page: 1, limit: 5, missingFields: undefined,
      projects: [{
        accession: 'MD-A001SU', node: 'mmb', name: 'Envelope protein E', type: 'trajectory',
        keywords: ['protein', 'membrane'], atoms: 51495, mds: 2, frames: 10002, timeNs: 30006,
        pdb: [], uniprot: ['P0DTC4'],
        fields: { 'metadata.FF': ['CHARMM36m'], 'mds.name': ['replica 1', 'replica 2'] },
      }],
    });
  });

  it('rounds summed times like analysis values', async () => {
    const result = await searchProjects(fakeApi([{ accession: 'A', metadata: {}, mds: [{ time: 0.1 }, { time: 0.2 }] }]), {});
    expect(result.projects[0].timeNs).toBe(0.3);
  });

  it('leaves out totals that no MD stores', async () => {
    const result = await searchProjects(fakeApi([{ accession: 'A00P6', metadata: {}, mds: [{ frames: 1000 }] }]), {});
    expect(result.projects[0]).toMatchObject({ mds: 1, frames: 1000, timeNs: undefined });
  });

  it('reports how many projects lack each queried field, skipping references.* and $or', async () => {
    const api = fakeApi([], { 'metadata.SYSKEYS': 606, 'metadata.TEMP': 0 });
    const result = await searchProjects(api, { query: {
      'metadata.SYSKEYS': 'protein',
      $and: [{ 'metadata.TEMP': { $gt: 300 } }],
      $or: [{ 'metadata.FF': 'x' }],
      'references.proteins.gene': 'ACE2',
    } });
    expect(result.missingFields).toEqual({ 'metadata.SYSKEYS': 606 });
    const counted = api.mock.calls.map(([, p]) => String(p?.query)).filter(q => q.includes('$exists'));
    expect(counted).toEqual(['{"metadata.SYSKEYS":{"$exists":false}}', '{"metadata.TEMP":{"$exists":false}}']);
  });
});

describe('projectOptions', () => {
  it('sorts values by count and sums up the ones beyond top', async () => {
    const api = jest.fn(async () => ({ 'metadata.TEMP': { 300: 5, 310: 9, 298: 1, 'null': 2 } }));
    expect(await projectOptions(api, { fields: ['metadata.TEMP'], top: 2 })).toEqual({
      'metadata.TEMP': { values: [['310', 9], ['300', 5]], otherValues: 2, otherCount: 3 },
    });
  });

  // The API answers 404 when no project matches the query
  it('counts no values when no project matches', async () => {
    const api = jest.fn(async () => { throw Object.assign(new Error('HTTP 404 from /projects/options: The result of query is empty'), { status: 404 }); });
    expect(await projectOptions(api, { fields: ['metadata.TYPE', 'metadata.FF'], query: { 'metadata.TEMP': 1 } })).toEqual({
      'metadata.TYPE': { values: [] }, 'metadata.FF': { values: [] },
    });
    const failing = jest.fn(async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); });
    await expect(projectOptions(failing, { fields: ['metadata.TYPE'] })).rejects.toThrow('HTTP 500');
  });

  it('always sends a query, since without one the API answers from stale precounted totals', async () => {
    const api = jest.fn(async () => ({}));
    await projectOptions(api, { fields: ['metadata.SYSKEYS'] });
    await projectOptions(api, { fields: ['metadata.SYSKEYS'], query: { a: 1, b: 2 } });
    expect(api.mock.calls.map(([, params]) => params?.query)).toEqual(['{}', ['{"a":1}', '{"b":2}']]);
  });
});

describe('getProject', () => {
  it('drops empty values, zero counts, viewer settings and duplicated sequences, and keeps unknown fields', async () => {
    const api = jest.fn(async () => ({
      _id: 'x', internalId: 'x', identifier: 'MD-A00001', accession: 'MD-A00001', mdIndex: 0, files: [],
      metadata: {
        NAME: 'MoDEL 12CA', THANKS: null, LIGANDS: [], DNAATS: 0, PROTATS: 4010, ORIENTATION: [1, 2], ATNAME: ['CA'],
        PROTSEQ: ['WGYG'], SEQUENCES: ['WGYG'], COVER: 0.93,
      },
    }));
    expect(await getProject(api, 'MD-A00001')).toEqual({
      accession: 'MD-A00001', mdIndex: 0,
      metadata: { NAME: 'MoDEL 12CA', PROTATS: 4010, PROTSEQ: ['WGYG'], COVER: 0.93 },
    });
    expect(api).toHaveBeenCalledWith('projects/MD-A00001');
  });

  // Legacy SEQUENCES also hold placeholder chains (e.g. thousands of X for a membrane), which PROTSEQ leaves out
  it('drops SEQUENCES when there is PROTSEQ, even if they differ', async () => {
    const api = jest.fn(async () => ({ accession: 'A', metadata: { PROTSEQ: ['WGYG'], SEQUENCES: ['WGYG', 'XXXXXX'] } }));
    expect(await getProject(api, 'A')).toEqual({ accession: 'A', metadata: { PROTSEQ: ['WGYG'] } });
  });

  it('keeps SEQUENCES in older projects without PROTSEQ', async () => {
    const api = jest.fn(async () => ({ accession: 'A', metadata: { SEQUENCES: ['GGTT'] } }));
    expect(await getProject(api, 'A')).toEqual({ accession: 'A', metadata: { SEQUENCES: ['GGTT'] } });
  });
});
