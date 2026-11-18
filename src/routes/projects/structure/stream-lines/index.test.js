const produceMmcif = require('../produce-mmcif');
const producePdb = require('../produce-pdb');

// A small system with values of different widths
const topology = {
  atom_names: ['N', "O5'", 'CA', 'CÁ', 'HD21'],
  atom_elements: ['N', 'O', 'C', 'C', 'H'],
  atom_residue_indices: [0, 1, 2, 3, 3],
  residue_names: ['ALA', 'DA', 'GLY', 'LONGRES'],
  residue_numbers: [1, 2, 300, 12345],
  residue_icodes: [undefined, 'B', undefined, undefined],
  residue_reference_numbers: [null, 102, 1003, null],
  residue_chain_indices: [0, 0, 1, 2],
  chain_names: ['A', 'LONG', 'Ñ'],
};
const coordinates = [[1, 2, 3], [-4.5, 5.25, 6.125], [7, -18.0004, 9], [-12345.6789, 0.0001, -0.0001], [99.9996, 1, 2]];

const stream = (producer, ...args) => {
  const { length, chunks } = producer.stream(...args);
  const buffer = Buffer.concat([...chunks]);
  return { length, buffer, content: buffer.toString('utf-8') };
};

const getAtomLines = content => content.split('\n').filter(line => line.startsWith('ATOM '));

describe.each([['mmCIF', produceMmcif], ['PDB', producePdb]])('%s', (_, producer) => {
  test('the expected length matches the produced bytes', () => {
    const { length, buffer } = stream(producer, topology, coordinates, undefined, 'TEST', true);
    expect(length).toBe(buffer.length);
  });

  test('there is no expected length when not requested', () => {
    expect(stream(producer, topology, coordinates, undefined, 'TEST', false).length).toBeUndefined();
  });

  test('structures with and without length have the same values', () => {
    const fields = content => getAtomLines(content).map(line => line.trim().split(/\s+/));
    const aligned = stream(producer, topology, coordinates, undefined, 'TEST', true).content;
    const notAligned = stream(producer, topology, coordinates, undefined, 'TEST', false).content;
    expect(fields(aligned)).toEqual(fields(notAligned));
  });

  test('the string producer returns the stream without length', () => {
    expect(producer(topology, coordinates, undefined, 'TEST'))
      .toBe(stream(producer, topology, coordinates, undefined, 'TEST', false).content);
  });

  test('selections are written in atom index order', () => {
    const { length, buffer, content } = stream(producer, topology, [[1, 1, 1], [3, 3, 3]], [3, 1], 'TEST', true);
    expect(length).toBe(buffer.length);
    const lines = getAtomLines(content);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('1.000');
    expect(lines[1]).toContain('3.000');
  });

  test('big structures are written in several chunks with the expected length', () => {
    const nAtoms = 25001;
    const bigTopology = {
      ...topology,
      atom_names: Array(nAtoms).fill('CA'),
      atom_elements: Array(nAtoms).fill('C'),
      atom_residue_indices: Array.from({ length: nAtoms }, (_, index) => index % 4),
    };
    const bigCoordinates = Array.from({ length: nAtoms }, (_, index) => [index / 7, -index / 3, index % 11]);
    const { length, chunks } = producer.stream(bigTopology, bigCoordinates, undefined, 'TEST', true);
    const buffers = [...chunks];
    expect(buffers.length).toBeGreaterThan(3);
    expect(length).toBe(Buffer.concat(buffers).length);
    expect(getAtomLines(Buffer.concat(buffers).toString())).toHaveLength(nAtoms);
  });
});

test('mmCIF atom lines have the same length in bytes when the length is requested', () => {
  const lines = getAtomLines(stream(produceMmcif, topology, coordinates, undefined, 'TEST', true).content);
  expect(lines).toHaveLength(5);
  expect(new Set(lines.map(line => Buffer.byteLength(line))).size).toBe(1);
});

test('PDB is the same with and without length, even with values which do not fit in their columns', () => {
  const pdbCoordinates = [...coordinates.slice(0, 4), [99999.9996, NaN, -999.9996]];
  const { length, buffer, content } = stream(producePdb, topology, pdbCoordinates, undefined, 'TEST', true);
  expect(length).toBe(buffer.length);
  expect(content).toBe(producePdb(topology, pdbCoordinates));
  expect(getAtomLines(content)[3]).toContain('-12345.679   0.000  -0.000');
});

test('mmCIF non finite coordinates are written as they are', () => {
  const { length, buffer, content } = stream(produceMmcif, topology,
    [[NaN, 1, 2], [Infinity, 1, 2], [1, 2, 3], [1, 2, 3], [1, 2, 3]], undefined, 'TEST', true);
  expect(length).toBe(buffer.length);
  expect(getAtomLines(content)[0].split(/\s+/)[10]).toBe('NaN');
});
