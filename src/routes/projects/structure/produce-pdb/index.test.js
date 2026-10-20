const producePdb = require('.');

test('atom serial rollover preserves fixed columns and coordinate indexing', () => {
  const nAtoms = 200001;
  const topology = {
    atom_names: Array(nAtoms).fill('CA'),
    atom_elements: Array(nAtoms).fill('C'),
    atom_residue_indices: Array(nAtoms).fill(0),
    residue_names: ['ALA'],
    residue_numbers: [1],
    residue_chain_indices: [0],
    chain_names: ['A'],
  };
  const coordinates = Array(nAtoms).fill([1.25, -2.5, 3.75]);
  coordinates[99999] = [4.5, 5.25, -6.75];
  const lines = producePdb(topology, coordinates).trimEnd().split('\n').slice(1);

  expect(lines).toHaveLength(nAtoms);
  for (const [index, serial] of [[0, '    1'], [99998, '99999'],
    [99999, '    1'], [100000, '    2'], [199997, '99999'],
    [199998, '    1'], [199999, '    2'], [200000, '    3']]) {
    const line = lines[index];
    expect(line).toHaveLength(78);
    expect(line.slice(6, 11)).toBe(serial);
    expect(line.slice(12, 16)).toBe(' CA ');
    expect(line.slice(17, 20)).toBe('ALA');
    expect(line[21]).toBe('A');
    expect(line.slice(22, 26)).toBe('   1');
    expect([line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)].map(Number))
      .toEqual(coordinates[index]);
    expect(line.slice(76, 78)).toBe(' C');
  }
});

// The structure route loads only these topology fields, so the PDB must not need any other
test('reads only the topology fields it declares', () => {
  const topology = {
    atom_names: ['CA'],
    atom_elements: ['C'],
    atom_residue_indices: [0],
    residue_names: ['ALA'],
    residue_numbers: [1],
    residue_icodes: ['A'],
    residue_chain_indices: [0],
    chain_names: ['A'],
  };
  const strictTopology = new Proxy(topology, {
    get: (target, field) => {
      if (!producePdb.TOPOLOGY_FIELDS.has(field)) throw new Error(`Undeclared topology field read: ${field}`);
      return target[field];
    },
  });
  expect(producePdb(strictTopology, [[1, 2, 3]])).toBe(producePdb(topology, [[1, 2, 3]]));
});
