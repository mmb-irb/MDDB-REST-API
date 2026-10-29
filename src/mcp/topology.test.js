const { getTopology } = require('./topology');

// A protein chain with a numbering gap and an ion, then a lipid chain, as newer workflows store them
const topology = {
  residue_names: ['MET', 'HIE', 'CYX', 'NA', 'POPC', 'POPC', 'CHL1'],
  residue_numbers: [1, 2, 10, 11, 1, 2, 3],
  residue_icodes: { 2: 'A' },
  residue_chain_indices: [0, 0, 0, 0, 1, 1, 1],
  chain_names: ['A', 'M'],
  references: ['P0DTC4', 'WTJKGGKOPKCXLL-VYOBOKEXSA-N'],
  reference_types: ['protein', 'inchikey'],
  residue_reference_indices: [0, 0, 0, null, 1, 1, null],
  residue_reference_numbers: [5, 6, 14, null, null, null, null],
  selections: { protein: { n: 40, ch: [0] }, fatty: { n: 268, re: [4, 5] }, pbc: 'all' },
  version: '0.2.0',
};

// Old topologies have no reference types nor selections, and null reference lists
const legacyTopology = {
  residue_names: ['DT', 'DG5', 'ARG'],
  residue_numbers: [1, 2, 3],
  residue_icodes: null,
  residue_chain_indices: [0, 0, 1],
  chain_names: ['A', 'B'],
  references: null,
  residue_reference_indices: null,
  residue_reference_numbers: null,
};

describe('getTopology', () => {
  it('summarizes chains from the residue fields only', async () => {
    const api = jest.fn(async () => topology);
    expect(await getTopology(api, { accession: 'MD-A001SU' })).toEqual({
      version: '0.2.0',
      residues: 7,
      chains: [
        { name: 'A', residues: 4, numbers: '1-2, 10-11', sequence: 'MHC', otherResidues: { NA: 1 }, references: ['P0DTC4'] },
        { name: 'M', residues: 3, numbers: '1-3', otherResidues: { POPC: 2, CHL1: 1 },
          references: ['WTJKGGKOPKCXLL-VYOBOKEXSA-N'] },
      ],
      references: [{ id: 'P0DTC4', type: 'protein' }, { id: 'WTJKGGKOPKCXLL-VYOBOKEXSA-N', type: 'inchikey' }],
      selections: { protein: 40, fatty: 268, pbc: 'all' },
    });
    const [path, params] = api.mock.calls[0];
    expect(path).toBe('projects/MD-A001SU/topology');
    expect(params?.include).not.toContain('atom_names');
  });

  it('summarizes topologies without references or selections', async () => {
    expect(await getTopology(jest.fn(async () => legacyTopology), { accession: 'A' })).toEqual({
      residues: 3,
      chains: [{ name: 'A', residues: 2, numbers: '1-2', sequence: 'TG' }, { name: 'B', residues: 1, numbers: '3', sequence: 'R' }],
    });
  });

  it('cuts long lists of number ranges', async () => {
    const scattered = { ...legacyTopology, residue_names: Array(12).fill('DT'), residue_numbers: Array.from({ length: 12 }, (_, i) => i * 10),
      residue_chain_indices: Array(12).fill(0), chain_names: ['A'] };
    const summary = await getTopology(jest.fn(async () => scattered), { accession: 'A' });
    expect(summary.chains[0].numbers).toBe('0, 10, 20, 30, 40, 50, 60, 70, 80, 90, … 2 more ranges');
  });

  it('describes residues by index, with their reference position', async () => {
    const result = await getTopology(jest.fn(async () => topology), { accession: 'A', residues: [2, 5] });
    expect(result).toEqual({ residues: [
      { index: 2, chain: 'A', name: 'CYX', number: 10, icode: 'A', reference: 'P0DTC4', referenceNumber: 14 },
      { index: 5, chain: 'M', name: 'POPC', number: 2, reference: 'WTJKGGKOPKCXLL-VYOBOKEXSA-N' },
    ] });
    await expect(getTopology(jest.fn(async () => legacyTopology), { accession: 'A', residues: [3] }))
      .rejects.toThrow('Residue index 3 is out of range: there are 3 residues');
  });

  it('asks the API for just the requested atoms and maps its renumbered subset back', async () => {
    // What the API answers for atoms 5 and 3000: in index order, with residues renumbered within the subset
    const api = jest.fn(async () => ({
      atom_names: ['HA', 'HG21'], atom_elements: ['H', 'H'], atom_residue_indices: [0, 1],
      residue_names: ['TRP', 'THR'], residue_numbers: [1, 194], residue_chain_indices: [0, 0], chain_names: ['A'],
    }));
    const result = await getTopology(api, { accession: 'A0001', atoms: [3000, 5, 5] });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][1]?.atomindices).toBe('5,3000');
    expect(result.atoms).toEqual([
      { index: 3000, name: 'HG21', element: 'H', residue: { chain: 'A', name: 'THR', number: 194 } },
      { index: 5, name: 'HA', element: 'H', residue: { chain: 'A', name: 'TRP', number: 1 } },
      { index: 5, name: 'HA', element: 'H', residue: { chain: 'A', name: 'TRP', number: 1 } },
    ]);
  });
});
