const { getDownloadUrl } = require('./downloads');

const structure = { url: 'https://irb.mddbr.eu/api/rest/v1/projects/A0001/structure', filename: 'A0001.1_structure.pdb',
  contentType: 'chemical/x-pdb', bytes: 316824 };

// Answers like a node API that ignores numbering and arguments it doesn't know, unless told otherwise
const fakeProbe = (answer = () => ({})) =>
  jest.fn(async (path, params = {}) => ({ ...structure, ...answer(path, params) }));

describe('getDownloadUrl', () => {
  it('links a stored file by name', async () => {
    const probe = fakeProbe(() => ({ filename: 'A0001.1_trajectory.xtc', bytes: 152164612 }));
    expect(await getDownloadUrl(probe, { accession: 'MD-A00001', data: 'file', filename: 'trajectory.xtc' }))
      .toMatchObject({ filename: 'A0001.1_trajectory.xtc', bytes: 152164612 });
    expect(probe).toHaveBeenCalledWith('projects/MD-A00001/files/trajectory.xtc');
    await expect(getDownloadUrl(probe, { accession: 'A0001', data: 'file' })).rejects.toThrow('Pass the filename');
  });

  it('passes frames, selections and indices with the API argument names', async () => {
    const probe = fakeProbe(() => ({ filename: 'A0001.1_trajectory.xtc', bytes: undefined }));
    await getDownloadUrl(probe, { accession: 'A0001', data: 'trajectory', format: 'xtc', frames: '1:1000:10',
      atoms: '0-9', residues: '3', chains: '0' });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith('projects/A0001/trajectory', expect.objectContaining({
      format: 'xtc', frames: '1:1000:10', atomindices: '0-9', resindices: '3', chaindices: '0' }));
  });

  it('refuses a link that serves another format than the requested one', async () => {
    await expect(getDownloadUrl(fakeProbe(), { accession: 'A0001', data: 'structure', format: 'mmcif' }))
      .rejects.toThrow('This API served A0001.1_structure.pdb instead of mmcif: its version does not support mmcif');
    const newer = fakeProbe(() => ({ filename: 'A0001.1_structure.cif' }));
    expect(await getDownloadUrl(newer, { accession: 'A0001', data: 'structure', format: 'mmcif' }))
      .toMatchObject({ filename: 'A0001.1_structure.cif' });
  });

  it('refuses UniProt numbering when the API ignores the argument', async () => {
    await expect(getDownloadUrl(fakeProbe(), { accession: 'A0001', data: 'structure', numbering: 'uniprot' }))
      .rejects.toThrow('This API version ignores numbering');
    const newer = jest.fn(async (_, params = {}) => {
      if (params.numbering === 'unknown') throw new Error('HTTP 400: Unknown numbering "unknown"');
      return structure;
    });
    expect(await getDownloadUrl(newer, { accession: 'A0001', data: 'structure', numbering: 'uniprot' })).toEqual(structure);
  });

  it('warns when the selection matched every atom, as an unparseable one does', async () => {
    const unparsed = await getDownloadUrl(fakeProbe(), { accession: 'A0001', data: 'trajectory', selection: 'nonsense((' });
    expect(unparsed).toMatchObject({ warning: expect.stringContaining('the API could not parse it') });
    const parsed = fakeProbe((_, params) => params.selection ? { bytes: 20179 } : {});
    expect(await getDownloadUrl(parsed, { accession: 'A0001', data: 'structure', selection: '.CA' }))
      .toEqual({ ...structure, bytes: 20179 });
  });
});
