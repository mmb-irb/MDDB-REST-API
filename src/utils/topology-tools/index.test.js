const { MISSING_BONDS, duplicateBonds, subsetTopology } = require('.');

describe('duplicateBonds()', () => {
  test('adds every bond to the other atom', () => {
    expect(duplicateBonds([[1, 2], [2], []])).toEqual([[1, 2], [2, 0], [0, 1]]);
  });
  test('keeps atoms with missing bonds as missing', () => {
    expect(duplicateBonds([[1, 2], MISSING_BONDS, [], [2]]))
      .toEqual([[1, 2], MISSING_BONDS, [0, 3], [2]]);
  });
});

describe('subsetTopology()', () => {
  // Chain A: residue 0 (atoms 0, 1), residue 1 (atoms 2, 3)
  // Chain B: residue 2 (atoms 4, 5)
  const topology = {
    atom_names: ['N0', 'C0', 'N1', 'C1', 'N2', 'C2'],
    atom_residue_indices: [0, 0, 1, 1, 2, 2],
    atom_bonds: [[1], [2], [3], MISSING_BONDS, [5], []],
    residue_names: ['ALA', 'GLY', 'LIG'],
    residue_numbers: [1, 2, 1],
    residue_icodes: { 1: 'A', 2: 'B' },
    residue_chain_indices: [0, 0, 1],
    chain_names: ['A', 'B'],
    references: ['P1', 'L1'],
    reference_types: ['uniprot', 'inchikey'],
    residue_reference_indices: [0, 0, 1],
    residue_reference_numbers: [1, 2, null],
    selections: { protein: { n: 4, ch: [0] }, ligand: { n: 2, re: [2] }, odd: { n: 2, at: [1, 3] }, everything: 'all' },
  };
  // Reduce per-atom and per-residue fields before, as the API does
  const subset = atomIndices => {
    const residueIndices = [...new Set(atomIndices.map(i => topology.atom_residue_indices[i]))];
    const reduced = { ...topology };
    ['atom_names', 'atom_residue_indices', 'atom_bonds'].forEach(field => {
      reduced[field] = atomIndices.map(i => topology[field][i]);
    });
    ['residue_names', 'residue_numbers', 'residue_chain_indices', 'residue_reference_indices', 'residue_reference_numbers']
      .forEach(field => { reduced[field] = residueIndices.map(i => topology[field][i]) });
    return subsetTopology(reduced, atomIndices, topology.atom_residue_indices, topology.residue_chain_indices);
  };

  test('renumbers atoms, residues, chains and references', () => {
    const result = subset([3, 4, 5]);
    expect(result.atom_names).toEqual(['C1', 'N2', 'C2']);
    expect(result.atom_residue_indices).toEqual([0, 1, 1]);
    expect(result.atom_bonds).toEqual([MISSING_BONDS, [2], []]);
    expect(result.residue_names).toEqual(['GLY', 'LIG']);
    expect(result.residue_icodes).toEqual({ 0: 'A', 1: 'B' });
    expect(result.residue_chain_indices).toEqual([0, 1]);
    expect(result.chain_names).toEqual(['A', 'B']);
    expect(result.references).toEqual(['P1', 'L1']);
    expect(result.residue_reference_indices).toEqual([0, 1]);
  });

  test('removes bonds with atoms out of the selection', () => {
    expect(subset([0, 2, 3]).atom_bonds).toEqual([[], [2], MISSING_BONDS]);
  });

  test('removes icodes of residues out of the selection', () => {
    expect(subset([0, 1]).residue_icodes).toBe(null);
  });

  test('removes unused chains and references', () => {
    const result = subset([4, 5]);
    expect(result.chain_names).toEqual(['B']);
    expect(result.residue_chain_indices).toEqual([0]);
    expect(result.references).toEqual(['L1']);
    expect(result.reference_types).toEqual(['inchikey']);
    expect(result.residue_reference_indices).toEqual([0]);
  });

  test('reformats selections in the new indices', () => {
    expect(subset([1, 2, 3]).selections).toEqual({
      protein: 'all',
      odd: { n: 2, re: [0], at: [2] },
      everything: 'all',
    });
    expect(subset([0, 1, 3, 4, 5]).selections).toEqual({
      protein: { n: 3, ch: [0] },
      ligand: { n: 2, ch: [1] },
      odd: { n: 2, re: [1], at: [1] },
      everything: 'all',
    });
  });
});
