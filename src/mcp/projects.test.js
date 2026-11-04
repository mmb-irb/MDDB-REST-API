const { FIELD_CATALOG, fieldCatalog, getProject, projectOptions, searchProjects } = require('./projects');

// Answers /projects searches with `projects`, and counts of projects with no value in a field from `missing`
const NO_VALUE_FILTER = /^(.*)=eq=$/;
const fakeApi = (projects, missing = {}) => jest.fn(async (_path, params = {}) => {
  const match = typeof params.filter === 'string' && params.filter.match(NO_VALUE_FILTER);
  if (match) return { filteredCount: missing[match[1]] ?? 0, projects: [] };
  return { filteredCount: 1234, projects };
});
// Get the parameters of the search request, leaving out the counts of projects with no value
const searchParams = api => api.mock.calls.find(([, params]) => Array.isArray(params?.filter))[1];

describe('fieldCatalog', () => {
  it('lists the fields from mddb-database, including the sequences', () => {
    expect(FIELD_CATALOG).toContain('proteinSequence = metadata.PROTSEQ (string): ');
    expect(FIELD_CATALOG).toContain('= metadata.NUCLSEQ (string): ');
  });

  it('gives each field alias and describes it, or names it when it has no description, and leaves out generic examples', () => {
    expect(fieldCatalog([
      { name: 'Temperature (K)', path: 'metadata.TEMP', alias: 'temperature', description: 'Temperature in Kelvin (K).', type: 'float', example: '300' },
      { name: 'Protein sequence', path: 'metadata.PROTSEQ', alias: 'proteinSequence', type: 'string', example: 'VNLTTRT' },
      { name: 'System atom count', path: 'metadata.SYSTATS', alias: 'systemAtoms', type: 'int', example: 'any integer number' },
    ])).toBe([
      'temperature = metadata.TEMP (float): Temperature in Kelvin (K). E.g. 300',
      'proteinSequence = metadata.PROTSEQ (string): Protein sequence E.g. VNLTTRT',
      'systemAtoms = metadata.SYSTATS (int): System atom count',
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

  it('passes the filters, adds extra fields to the returned ones, and sums frames and time over MDs', async () => {
    const api = fakeApi([project]);
    const filters = ["type=eq='trajectory'", "uniprotGene=eq='E'"];
    const result = await searchProjects(api, { filters, fields: ['metadata.FF', 'mds.name'], limit: 5 });
    const params = searchParams(api);
    expect(params.filter).toEqual(filters);
    expect(params.return).toEqual(expect.arrayContaining(['metadata.FF', 'mds.name', 'accession']));
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

  // Asking for a parent of a base field (e.g. metadata.NAME) would make the API refuse the returned fields
  it('asks for whole parents instead of their fields', async () => {
    const api = fakeApi([project]);
    const result = await searchProjects(api, { fields: ['metadata', 'mds'] });
    expect([...searchParams(api).return].sort()).toEqual(['accession', 'mds', 'metadata', 'node']);
    expect(result.projects[0]).toMatchObject({ name: 'Envelope protein E', frames: 10002, fields: { metadata: project.metadata } });
  });

  it('refuses results that would flood the context', async () => {
    const huge = { ...project, metadata: { ...project.metadata, PROTSEQ: ['A'.repeat(50000)] } };
    await expect(searchProjects(fakeApi([huge]), { fields: ['metadata'] }))
      .rejects.toThrow(/^The result is \d+ characters long. Ask for fewer fields or a smaller limit$/);
  });

  it('leaves out totals that no MD stores', async () => {
    const result = await searchProjects(fakeApi([{ accession: 'A00P6', metadata: {}, mds: [{ frames: 1000 }] }]), {});
    expect(result.projects[0]).toMatchObject({ mds: 1, frames: 1000, timeNs: undefined });
  });

  it('reports how many projects lack each filtered field, by its path and skipping references.*', async () => {
    const api = fakeApi([], { 'metadata.SYSKEYS': 606, 'metadata.TEMP': 0 });
    const result = await searchProjects(api, { filters: [
      "keyword=eq='protein'",
      'temperature=gt=300;metadata.SYSKEYS=ct=\'membrane\'',
      "uniprotGene=eq='ACE2'",
    ] });
    expect(result.missingFields).toEqual({ 'metadata.SYSKEYS': 606 });
    const counted = api.mock.calls.map(([, p]) => p?.filter).filter(filter => typeof filter === 'string');
    expect(counted).toEqual(['metadata.SYSKEYS=eq=', 'metadata.TEMP=eq=']);
  });

  it('refuses wrong filters with the message the API would answer', async () => {
    const api = fakeApi([project]);
    await expect(searchProjects(api, { filters: ['type=eq=trajectory'] })).rejects.toThrow(/must be quoted with single quotes/);
    expect(api).not.toHaveBeenCalled();
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
    expect(await projectOptions(api, { fields: ['metadata.TYPE', 'metadata.FF'], filters: ['temperature=eq=1'] })).toEqual({
      'metadata.TYPE': { values: [] }, 'metadata.FF': { values: [] },
    });
    const failing = jest.fn(async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); });
    await expect(projectOptions(failing, { fields: ['metadata.TYPE'] })).rejects.toThrow('HTTP 500');
  });

  it('passes the fields, the text and the filters', async () => {
    const api = jest.fn(async () => ({}));
    await projectOptions(api, { fields: ['metadata.SYSKEYS'], text: 'spike', filters: ["type=eq='md'"] });
    expect(api).toHaveBeenCalledWith('projects/options', { return: ['metadata.SYSKEYS'], search: 'spike', filter: ["type=eq='md'"] });
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
