// Tools to handle topology data once it is loaded

// Set the value used in the topology to flag atoms with missing bonds
const MISSING_BONDS = 'MB';

// Topology fields with one value per atom and per residue
// Note that residue icodes are not here since they are a dictionary with only the residues having icode
const ATOM_FIELDS = ['atom_names', 'atom_elements', 'atom_species_indices', 'atom_charges', 'atom_residue_indices', 'atom_bonds'];
const RESIDUE_FIELDS = ['residue_names', 'residue_species_indices', 'residue_numbers', 'residue_chain_indices',
  'residue_reference_indices', 'residue_reference_numbers'];
const REFERENCE_FIELDS = ['references', 'reference_types'];

// Given a list of indices, get a map to convert every old index to its position in the list
// Old indices which are not in the list are mapped to -1
const getIndexMap = (indices, length) => {
  const indexMap = new Int32Array(length).fill(-1);
  indices.forEach((oldIndex, newIndex) => { indexMap[oldIndex] = newIndex });
  return indexMap;
};

// Get sorted unique values from a list
const sortedUnique = values => [...new Set(values)].sort((a, b) => a - b);

// Bonds are stored only once (in one of the two bonded atoms)
// Add every bond to the other atom as well
const duplicateBonds = atomBonds => {
  const duplicated = atomBonds.map(bonds => bonds === MISSING_BONDS ? MISSING_BONDS : [...bonds]);
  atomBonds.forEach((bonds, atomIndex) => {
    if (bonds === MISSING_BONDS) return;
    bonds.forEach(bondedAtomIndex => {
      // If the other atom has missing bonds then we do not know all its bonds, so we leave it as missing
      if (duplicated[bondedAtomIndex] === MISSING_BONDS) return;
      duplicated[bondedAtomIndex].push(atomIndex);
    });
  });
  return duplicated;
};

// Get the atom indices of a topology selection
// Selections are formatted as chain (ch), residue (re) and atom (at) indices, or the string 'all'
const getSelectionAtomIndices = (selection, atomResidueIndices, residueChainIndices) => {
  if (selection === 'all') return atomResidueIndices.map((_, atomIndex) => atomIndex);
  const chainIndices = new Set(selection.ch || []);
  const residueIndices = new Set(selection.re || []);
  const atomIndices = new Set(selection.at || []);
  return atomResidueIndices.reduce((selected, residueIndex, atomIndex) => {
    if (atomIndices.has(atomIndex) || residueIndices.has(residueIndex) ||
      chainIndices.has(residueChainIndices[residueIndex])) selected.push(atomIndex);
    return selected;
  }, []);
};

// Format a list of atom indices as a topology selection, using whole chains and residues when possible
// This is the same format the workflow uses
const formatSelection = (atomIndices, atomResidueIndices, residueChainIndices) => {
  if (atomIndices.length === atomResidueIndices.length) return 'all';
  // Count atoms in every residue and chain, both in the whole topology and in the selection
  const residueAtomCounts = new Array(residueChainIndices.length).fill(0);
  const chainAtomCounts = [];
  atomResidueIndices.forEach(residueIndex => {
    residueAtomCounts[residueIndex] += 1;
    const chainIndex = residueChainIndices[residueIndex];
    chainAtomCounts[chainIndex] = (chainAtomCounts[chainIndex] || 0) + 1;
  });
  const selectedResidueAtomCounts = new Array(residueChainIndices.length).fill(0);
  const selectedChainAtomCounts = [];
  atomIndices.forEach(atomIndex => {
    const residueIndex = atomResidueIndices[atomIndex];
    selectedResidueAtomCounts[residueIndex] += 1;
    const chainIndex = residueChainIndices[residueIndex];
    selectedChainAtomCounts[chainIndex] = (selectedChainAtomCounts[chainIndex] || 0) + 1;
  });
  const isWholeChain = chainIndex => selectedChainAtomCounts[chainIndex] === chainAtomCounts[chainIndex];
  const isWholeResidue = residueIndex => selectedResidueAtomCounts[residueIndex] === residueAtomCounts[residueIndex];
  const chains = sortedUnique(atomIndices.map(atomIndex => residueChainIndices[atomResidueIndices[atomIndex]]))
    .filter(isWholeChain);
  const residues = sortedUnique(atomIndices.map(atomIndex => atomResidueIndices[atomIndex]))
    .filter(residueIndex => !isWholeChain(residueChainIndices[residueIndex]) && isWholeResidue(residueIndex));
  const atoms = atomIndices.filter(atomIndex => {
    const residueIndex = atomResidueIndices[atomIndex];
    return !isWholeChain(residueChainIndices[residueIndex]) && !isWholeResidue(residueIndex);
  });
  const formatted = { n: atomIndices.length };
  if (chains.length > 0) formatted.ch = chains;
  if (residues.length > 0) formatted.re = residues;
  if (atoms.length > 0) formatted.at = atoms;
  return formatted;
};

// Renumber all indices in a topology reduced to a selection of atoms, so the topology is coherent by itself
// Atom indices must be sorted and unique, as in the structure and trajectory endpoints
// Per-atom and per-residue fields must already contain the selected atoms and their residues only, but with their original values
// Atom residue indices and residue chain indices of the whole topology must be passed apart to renumber selections
// Bonds with atoms out of the selection are removed
const subsetTopology = (topology, atomIndices, allAtomResidueIndices, allResidueChainIndices) => {
  const subset = { ...topology };
  const atomMap = getIndexMap(atomIndices, allAtomResidueIndices.length);
  // Get the residues with at least one selected atom
  const residueIndices = sortedUnique(atomIndices.map(atomIndex => allAtomResidueIndices[atomIndex]));
  const residueMap = getIndexMap(residueIndices, allResidueChainIndices.length);
  // Get the chains of these residues
  const chainIndices = sortedUnique(residueIndices.map(residueIndex => allResidueChainIndices[residueIndex]));
  const chainMap = getIndexMap(chainIndices, topology['chain_names'].length);
  // Renumber atom fields
  subset['atom_residue_indices'] = topology['atom_residue_indices'].map(residueIndex => residueMap[residueIndex]);
  if (Array.isArray(topology['atom_bonds'])) subset['atom_bonds'] = topology['atom_bonds'].map(bonds => {
    if (bonds === MISSING_BONDS) return MISSING_BONDS;
    return bonds.filter(bondedAtomIndex => atomMap[bondedAtomIndex] !== -1)
      .map(bondedAtomIndex => atomMap[bondedAtomIndex]);
  });
  // Renumber residue fields
  subset['residue_chain_indices'] = topology['residue_chain_indices'].map(chainIndex => chainMap[chainIndex]);
  if (topology['residue_icodes']) {
    const residueIcodes = {};
    Object.entries(topology['residue_icodes']).forEach(([residueIndex, icode]) => {
      const newResidueIndex = residueMap[residueIndex];
      if (newResidueIndex !== -1) residueIcodes[newResidueIndex] = icode;
    });
    subset['residue_icodes'] = Object.keys(residueIcodes).length > 0 ? residueIcodes : null;
  }
  // Keep only selected chains
  subset['chain_names'] = chainIndices.map(chainIndex => topology['chain_names'][chainIndex]);
  // Keep only references of selected residues
  const residueReferenceIndices = topology['residue_reference_indices'];
  if (Array.isArray(residueReferenceIndices)) {
    const referenceIndices = sortedUnique(residueReferenceIndices.filter(referenceIndex => referenceIndex !== null));
    const referenceMap = getIndexMap(referenceIndices, topology['references'].length);
    REFERENCE_FIELDS.forEach(field => {
      if (Array.isArray(topology[field])) subset[field] = referenceIndices.map(referenceIndex => topology[field][referenceIndex]);
    });
    subset['residue_reference_indices'] = residueReferenceIndices.map(referenceIndex =>
      referenceIndex === null ? null : referenceMap[referenceIndex]);
  }
  // Keep only selections which have selected atoms and renumber them
  if (topology['selections']) {
    subset['selections'] = {};
    Object.entries(topology['selections']).forEach(([name, selection]) => {
      const selectedAtomIndices = getSelectionAtomIndices(selection, allAtomResidueIndices, allResidueChainIndices)
        .filter(atomIndex => atomMap[atomIndex] !== -1)
        .map(atomIndex => atomMap[atomIndex]);
      if (selectedAtomIndices.length === 0) return;
      subset['selections'][name] = formatSelection(selectedAtomIndices,
        subset['atom_residue_indices'], subset['residue_chain_indices']);
    });
  }
  return subset;
};

module.exports = {
  MISSING_BONDS,
  ATOM_FIELDS,
  RESIDUE_FIELDS,
  sortedUnique,
  duplicateBonds,
  subsetTopology,
};
