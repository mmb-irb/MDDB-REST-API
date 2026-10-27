const getAtomIndices = require('.');
const produceMmcif = require('../../routes/projects/structure/produce-mmcif');
const { applyNumbering } = require('../topology-tools');

jest.setTimeout(15000);

describe('getAtomIndices', () => {
  // A lysine, as the API sends it to NGL
  const testExample = Buffer.from(produceMmcif({
    atom_names: ['N', 'CA', 'CB', 'CG', 'CD', 'CE', 'NZ', 'C'],
    atom_elements: ['N', 'C', 'C', 'C', 'C', 'C', 'N', 'C'],
    atom_residue_indices: Array(8).fill(0),
    residue_names: ['LYS'],
    residue_numbers: [1],
    residue_chain_indices: [0],
    chain_names: ['A'],
  }, [
    [-7.369, -7.158, 33.750], [-7.598, -6.930, 32.650], [-6.617, -7.323, 32.039], [-5.711, -6.881, 32.083],
    [-5.101, -6.980, 31.705], [-4.266, -6.635, 31.782], [-3.783, -6.629, 31.569], [-8.755, -7.388, 32.183],
  ]));

  test('no selection', async () => {
    expect(await getAtomIndices(testExample, '')).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('backbone selection', async () => {
    expect(await getAtomIndices(testExample, 'backbone')).toEqual([0, 1, 7]);
  });

  test('all carbons selection', async () => {
    expect(await getAtomIndices(testExample, '_C')).toEqual([1, 2, 3, 4, 5, 7]);
  });

  test('all single carbons selection', async () => {
    expect(await getAtomIndices(testExample, '.C')).toEqual([7]);
  });

  test('combined selections', async () => {
    expect(await getAtomIndices(testExample, 'backbone and _C')).toEqual([1, 7]);
  });

  // Selections use the author numeration (not the reference one) and chain names longer than one character
  test('author numbers and long chain names', async () => {
    const example = Buffer.from(produceMmcif({
      atom_names: ['CA', 'CA', 'CA'],
      atom_elements: ['C', 'C', 'C'],
      atom_residue_indices: [0, 1, 2],
      residue_names: ['ALA', 'GLY', 'ALA'],
      residue_numbers: [1, 2, 10000],
      residue_reference_numbers: [101, 102, null],
      residue_chain_indices: [0, 0, 1],
      chain_names: ['A', 'LONG'],
    }, [[0, 0, 0], [3.8, 0, 0], [20, 0, 0]]));
    expect(await getAtomIndices(example, '2')).toEqual([1]);
    expect(await getAtomIndices(example, '101')).toEqual([]);
    expect(await getAtomIndices(example, '10000')).toEqual([2]);
    expect(await getAtomIndices(example, ':LONG')).toEqual([2]);
    expect(await getAtomIndices(example, 'ALA and :A')).toEqual([0]);
  });

  // The UniProt numeration is applied to the topology before producing the mmCIF
  test('UniProt numbers', async () => {
    const example = Buffer.from(produceMmcif(applyNumbering({
      atom_names: ['CA', 'CA', 'C1'],
      atom_elements: ['C', 'C', 'C'],
      atom_residue_indices: [0, 1, 2],
      residue_names: ['ALA', 'GLY', 'LIG'],
      residue_numbers: [1, 2, 3],
      residue_reference_numbers: [101, 102, null],
      residue_chain_indices: [0, 0, 1],
      chain_names: ['A', 'B'],
    }, 'uniprot'), [[0, 0, 0], [3.8, 0, 0], [20, 0, 0]]));
    expect(await getAtomIndices(example, '102')).toEqual([1]);
    expect(await getAtomIndices(example, '2')).toEqual([]);
    expect(await getAtomIndices(example, '3')).toEqual([2]);
  });
});
