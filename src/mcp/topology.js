const { RESIDUE_LETTERS } = require('./residues');

// Everything but the per-atom lists, which take most of a topology (e.g. 208 KB of 42 MB for 937k atoms)
const RESIDUE_FIELDS = [
  'residue_names', 'residue_numbers', 'residue_icodes', 'residue_chain_indices', 'chain_names', 'references',
  'reference_types', 'residue_reference_indices', 'residue_reference_numbers', 'selections', 'version',
];
const ATOM_FIELDS = [
  'atom_names', 'atom_elements', 'atom_residue_indices', 'residue_names', 'residue_numbers', 'residue_chain_indices',
  'chain_names',
];
const MAX_RANGES = 10;

// Residue number ranges, e.g. "1-120, 130-255"
const numberRanges = numbers => {
  const ranges = [];
  let start = numbers[0];
  numbers.forEach((number, index) => {
    const next = numbers[index + 1];
    if (next === number + 1) return;
    ranges.push(start === number ? `${number}` : `${start}-${number}`);
    start = next;
  });
  return ranges.length > MAX_RANGES
    ? ranges.slice(0, MAX_RANGES).join(', ') + `, … ${ranges.length - MAX_RANGES} more ranges`
    : ranges.join(', ');
};

// Older topologies store null instead of the reference lists
const residueReference = (topology, residueIndex) => {
  const referenceIndex = topology.residue_reference_indices?.[residueIndex];
  return referenceIndex == null ? undefined : topology.references?.[referenceIndex];
};

const summarize = topology => {
  const chains = topology.chain_names.map(name => ({ name, residues: [] }));
  topology.residue_chain_indices.forEach((chainIndex, residueIndex) => chains[chainIndex].residues.push(residueIndex));
  return {
    version: topology.version,
    residues: topology.residue_names.length,
    chains: chains.map(({ name, residues }) => {
      const residueNames = residues.map(index => topology.residue_names[index]);
      const sequence = residueNames.map(residueName => RESIDUE_LETTERS[residueName] ?? '').join('');
      const otherResidues = {};
      for (const residueName of residueNames) {
        if (!RESIDUE_LETTERS[residueName]) otherResidues[residueName] = (otherResidues[residueName] ?? 0) + 1;
      }
      const references = [...new Set(residues.map(index => residueReference(topology, index)).filter(Boolean))];
      return {
        name,
        residues: residues.length,
        numbers: numberRanges(residues.map(index => topology.residue_numbers[index])),
        sequence: sequence || undefined,
        otherResidues: Object.keys(otherResidues).length ? otherResidues : undefined,
        references: references.length ? references : undefined,
      };
    }),
    references: topology.references?.map((id, index) => ({ id, type: topology.reference_types?.[index] })),
    // Atom count of every selection saved by newer workflows: residue classes, pbc...
    selections: topology.selections && Object.fromEntries(Object.entries(topology.selections)
      .map(([name, selection]) => [name, selection === 'all' ? 'all' : selection.n])),
  };
};

const describeResidue = (topology, index) => {
  if (!(index < topology.residue_names.length)) {
    throw new Error(`Residue index ${index} is out of range: there are ${topology.residue_names.length} residues`);
  }
  return {
    index,
    chain: topology.chain_names[topology.residue_chain_indices[index]],
    name: topology.residue_names[index],
    number: topology.residue_numbers[index],
    icode: topology.residue_icodes?.[index],
    reference: residueReference(topology, index),
    referenceNumber: topology.residue_reference_numbers?.[index] ?? undefined,
  };
};

const getTopology = async (api, { accession, residues, atoms }) => {
  const path = `projects/${encodeURIComponent(accession)}/topology`;
  if (!residues && !atoms) return summarize(await api(path, { include: RESIDUE_FIELDS }));
  const atomIndices = atoms && [...new Set(atoms)].sort((a, b) => a - b);
  const [residueTopology, atomTopology] = await Promise.all([
    residues && api(path, { include: RESIDUE_FIELDS }),
    atomIndices && api(path, { atomindices: atomIndices.join(','), include: ATOM_FIELDS }),
  ]);
  return {
    residues: residues?.map(index => describeResidue(residueTopology, index)),
    // The API returns the requested atoms in index order, with residues and chains renumbered within them
    atoms: atoms?.map(index => {
      const position = atomIndices.indexOf(index);
      const residue = atomTopology.atom_residue_indices[position];
      return {
        index,
        name: atomTopology.atom_names[position],
        element: atomTopology.atom_elements[position],
        residue: {
          chain: atomTopology.chain_names[atomTopology.residue_chain_indices[residue]],
          name: atomTopology.residue_names[residue],
          number: atomTopology.residue_numbers[residue],
        },
      };
    }),
  };
};

module.exports = { RESIDUE_FIELDS, ATOM_FIELDS, getTopology };
