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

describe('getTopologyData() selections', () => {
  // Every MD may have a different PBC selection and indices may be grouped in ranges
  const topologyWithSelections = {
    ...topology,
    selections: {
      pbc: { mdmap: [0, 1], values: [{ n: 2, ch: [1] }, null] },
      protein: { n: 4, re: [[0, 1]] },
      odd: { n: 3, at: [[1, 2], 5] },
    },
  };
  const getSelections = async (mdIndex, selection) => {
    const mdProject = new Project({ accession: 'A0001', internalId: 'id', mdIndex }, {
      topologies: { findOne: async () => topologyWithSelections },
    });
    return (await mdProject.getTopologyData(new Set(['selections']), selection)).selections;
  };

  test('returns the selections of the requested MD', async () => {
    expect(await getSelections(0)).toEqual({
      pbc: { n: 2, ch: [1] },
      protein: { n: 4, re: [[0, 1]] },
      odd: { n: 3, at: [[1, 2], 5] },
    });
    expect(await getSelections(1)).toEqual({
      protein: { n: 4, re: [[0, 1]] },
      odd: { n: 3, at: [[1, 2], 5] },
    });
  });

  test('renumbers the selections when there is a custom selection', async () => {
    expect(await getSelections(0, { atomIndices: '2-5' })).toEqual({
      pbc: { n: 2, ch: [1] },
      protein: { n: 2, ch: [0] },
      odd: { n: 2, at: [0, 3] },
    });
  });
});
