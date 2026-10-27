const produceMmcif = require('.');
const producePdb = require('../produce-pdb');

const topology = {
  atom_names: ['N', "O5'", 'CA'],
  atom_elements: ['N', 'O', 'C'],
  atom_residue_indices: [0, 1, 2],
  residue_names: ['ALA', 'DA', 'GLY'],
  residue_numbers: [1, 2, 3],
  residue_icodes: [undefined, 'B', undefined],
  residue_chain_indices: [0, 0, 1],
  chain_names: ['A', 'LONG'],
};
const coordinates = [[1, 2, 3], [-4.5, 5.25, 6.125], [7, 8, 9]];

// Get the atom site rows, as the MDDB workflow mmCIF parser reads them
const getAtomRows = content => content.split('\n').filter(line => line.startsWith('ATOM ')).map(line => line.split(/\s+/));

test('writes atom sites in the standard column order', () => {
  const content = produceMmcif(topology, coordinates, undefined, 'MCNS00001');
  expect(content.startsWith('data_MCNS00001\n')).toBe(true);
  expect(content).toContain('loop_\n_atom_site.group_PDB\n_atom_site.id\n');
  const rows = getAtomRows(content);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toEqual(['ATOM', '1', 'N', 'N', '.', 'ALA', 'A', '?', '1', '?', '1.000', '2.000', '3.000',
    '1.00', '0.00', '?', '1', 'ALA', 'A', 'N', '1']);
  // Atom names with single quotes are double quoted
  expect(rows[1][3]).toBe('"O5\'"');
  expect(rows[1][9]).toBe('B');
  expect(rows[1].slice(10, 13)).toEqual(['-4.500', '5.250', '6.125']);
  // Chain names are not truncated
  expect(rows[2][6]).toBe('LONG');
});

test('filters atoms by index', () => {
  const rows = getAtomRows(produceMmcif(topology, [[7, 8, 9]], [2]));
  expect(rows).toHaveLength(1);
  expect(rows[0][1]).toBe('1');
  expect(rows[0][3]).toBe('CA');
});

test('writes reference numbers in label fields and author numbers in author fields', () => {
  // The first residue has no reference number (e.g. not a protein) so it uses the author number in both
  const rows = getAtomRows(produceMmcif({ ...topology, residue_reference_numbers: [null, 102, 103] }, coordinates));
  expect(rows.map(row => [row[8], row[16]])).toEqual([['1', '1'], ['102', '2'], ['103', '3']]);
  // With no references at all the author numbers are used in both
  const noReferenceRows = getAtomRows(produceMmcif({ ...topology, residue_reference_numbers: null }, coordinates));
  expect(noReferenceRows.map(row => [row[8], row[16]])).toEqual([['1', '1'], ['2', '2'], ['3', '3']]);
});

// The structure route loads only these topology fields, so the mmCIF must not need any other
test('reads only the topology fields it declares', () => {
  const fullTopology = { ...topology, residue_reference_numbers: [null, 102, 103] };
  const strictTopology = new Proxy(fullTopology, {
    get: (target, field) => {
      if (!produceMmcif.TOPOLOGY_FIELDS.has(field)) throw new Error(`Undeclared topology field read: ${field}`);
      return target[field];
    },
  });
  expect(produceMmcif(strictTopology, coordinates)).toBe(produceMmcif(fullTopology, coordinates));
  expect([...producePdb.TOPOLOGY_FIELDS].every(field => produceMmcif.TOPOLOGY_FIELDS.has(field))).toBe(true);
});
