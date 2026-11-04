const { findSimulations, getReferences } = require('./references');

describe('getReferences', () => {
  it('leaves out bulk data at any depth and empty values', async () => {
    const api = jest.fn(async () => ({
      inchikey: 'HVYWMOMLDIMFJA-DPAQBDIFSA-N', lipidmaps: false, swisslipids: {}, pubchem: null,
      ligand: { name: 'Cholesterol', formula: 'C27H46O', mol_block: '\n RDKit', morgan_fp_bit_array: [0, 1], mordred: { a: 1 } },
    }));
    expect(await getReferences(api, { type: 'inchikeys', id: 'HVYWMOMLDIMFJA-DPAQBDIFSA-N' })).toEqual({
      inchikey: 'HVYWMOMLDIMFJA-DPAQBDIFSA-N', lipidmaps: false, ligand: { name: 'Cholesterol', formula: 'C27H46O' },
    });
    expect(api).toHaveBeenCalledWith('references/inchikeys/HVYWMOMLDIMFJA-DPAQBDIFSA-N');
  });

  it('keeps the InterPro entries of InterProScan matches, merging their signatures and locations', async () => {
    const match = (library, accession, entry, start, end) =>
      ({ signature: { accession, signatureLibraryRelease: { library }, entry }, locations: [{ start, end }] });
    const kinase = { accession: 'IPR000719', name: 'Prot_kinase_dom', description: 'Protein kinase domain', type: 'DOMAIN' };
    const api = jest.fn(async () => ({ sequence: 'AAAG', version: '0.1', interproscan: { results: [{ matches: [
      match('PIRSR', 'PIRSR000660-1', null, 108, 219),
      match('PFAM', 'PF00069', kinase, 25, 312),
      match('SMART', 'SM00220', kinase, 25, 312),
    ] }] } }));
    expect(await getReferences(api, { type: 'chains', id: 'AAAG' })).toEqual({ sequence: 'AAAG', version: '0.1', interpro: [{
      accession: 'IPR000719', name: 'Protein kinase domain', type: 'DOMAIN', signatures: ['PFAM:PF00069', 'SMART:SM00220'],
      locations: '25-312',
    }] });
  });

  it('gets all the references of a project', async () => {
    const api = jest.fn(async () => [{ uniprot: 'P0DTC4', gene: null, ref_type: 'proteins' }]);
    expect(await getReferences(api, { accession: 'MD-A001SU' })).toEqual([{ uniprot: 'P0DTC4', ref_type: 'proteins' }]);
    expect(api).toHaveBeenCalledWith('projects/MD-A001SU/references');
  });

  it('lists the references to get one by one when all of them are too long', async () => {
    const api = jest.fn(async () => [
      { inchikey: 'HVYWMOMLDIMFJA-DPAQBDIFSA-N', ref_type: 'inchikeys', inchi: 'x'.repeat(30_000) },
      { pubchem: '5997', ref_type: 'ligands', name: 'x'.repeat(30_000) },
    ]);
    await expect(getReferences(api, { accession: 'MD-A00C7R' })).rejects.toThrow(
      /Get them one by one with type and id: inchikeys HVYWMOMLDIMFJA-DPAQBDIFSA-N, ligands 5997$/);
  });

  it('needs an accession or a type and id', async () => {
    await expect(getReferences(jest.fn(), { type: 'proteins' })).rejects.toThrow('Pass either an accession');
  });
});

describe('findSimulations', () => {
  const pointers = [
    { id: 'MD-A00017', api: 'http://mdposit.mddbr.eu/api/rest/v1/projects/MD-A00017', web: 'http://mdposit.mddbr.eu/#/id/MD-A00017',
      'metadata.NAME': 'MoDEL 1AJ2', presence: 0.2, coverage: 1 },
    { id: 'MDR00017902', api: 'https://mdrepo.org/api/v1/simulation_view/17902', web: 'https://mdrepo.org/explore/MDR00017902',
      'metadata.NAME': '8 ns simulation of 5v7a' },
    { id: 'MDR00017901', api: 'https://mdrepo.org/api/v1/simulation_view/17901', web: 'https://mdrepo.org/explore/MDR00017901' },
  ];

  it('names each simulation and its database, counts them by database and pages them', async () => {
    const api = jest.fn(async () => pointers);
    expect(await findSimulations(api, { type: 'proteins', id: 'P0AC13', limit: 2, page: 1 })).toEqual({
      total: 3, sources: { 'mdposit.mddbr.eu': 1, 'mdrepo.org': 2 }, page: 1, limit: 2, simulations: [
        { id: 'MD-A00017', source: 'mdposit.mddbr.eu', name: 'MoDEL 1AJ2', web: 'http://mdposit.mddbr.eu/#/id/MD-A00017',
          presence: 0.2, coverage: 1 },
        { id: 'MDR00017902', source: 'mdrepo.org', name: '8 ns simulation of 5v7a', web: 'https://mdrepo.org/explore/MDR00017902' },
      ],
    });
    expect(api).toHaveBeenCalledWith('pointers/proteins/P0AC13', { return: 'metadata.NAME' });
    const secondPage = await findSimulations(api, { type: 'proteins', id: 'P0AC13', limit: 2, page: 2 });
    expect(secondPage.simulations.map(simulation => simulation.id)).toEqual(['MDR00017901']);
  });
});
