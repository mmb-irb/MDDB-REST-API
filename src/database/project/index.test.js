const Project = require('.');
const { BAD_REQUEST } = require('../../utils/status-codes');

// Chain A: residue 0 (atoms 0, 1), residue 1 (atoms 2, 3)
// Chain B: residue 2 (atoms 4, 5)
const topology = {
  atom_names: ['N0', 'C0', 'N1', 'C1', 'N2', 'C2'],
  atom_residue_indices: [0, 0, 1, 1, 2, 2],
  residue_names: ['ALA', 'GLY', 'LIG'],
  residue_chain_indices: [0, 0, 1],
  chain_names: ['A', 'B'],
};
// Set a project whose database only has the topology above
const project = new Project({ accession: 'A0001', internalId: 'id' }, {
  topologies: { findOne: async () => topology },
});
// Get the atom names of a selection
const getAtomNames = async selection => {
  const topologyData = await project.getTopologyData(new Set(['atom_names']), selection);
  return topologyData.error ? topologyData : topologyData.atom_names;
};

describe('getTopologyData() with ranged selections', () => {
  test('parses ranged selections', async () => {
    expect(await getAtomNames({ atomIndices: '0, 2-3' })).toEqual(['N0', 'N1', 'C1']);
    expect(await getAtomNames({ residueIndices: '2' })).toEqual(['N2', 'C2']);
    expect(await getAtomNames({ chainIndices: '0' })).toEqual(['N0', 'C0', 'N1', 'C1']);
  });

  test('rejects ranges and indices beyond the number of atoms, residues and chains', async () => {
    const selections = [
      { atomIndices: '4-6' }, { atomIndices: '6' }, { atomIndices: '0-99999999999' },
      { residueIndices: '1-3' }, { residueIndices: '1-99999999999' },
      { chainIndices: '1-2' }, { chainIndices: '1-99999999999' },
    ];
    for (const selection of selections)
      expect((await getAtomNames(selection)).headerError).toBe(BAD_REQUEST);
  });

  test('rejects wrong indices', async () => {
    for (const atomIndices of ['0,a', ''])
      expect((await getAtomNames({ atomIndices })).headerError).toBe(BAD_REQUEST);
  });
});
