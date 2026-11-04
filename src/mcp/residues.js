// One-letter codes of residue names, as in the MDDB client (src/utils/topology-manager/residues-library)
const AMINO_ACIDS = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
};

const PROTEIN_LETTERS = {
  // Every amino acid also as an N- and C-terminal residue, e.g. ALAN and ALAC
  ...Object.fromEntries(Object.entries(AMINO_ACIDS).flatMap(([name, letter]) =>
    [[name, letter], [name + 'N', letter], [name + 'C', letter]])),
  // Protonation states and other force field names
  CYH: 'C', CSH: 'C', CSS: 'C', CYX: 'C', CYP: 'C', GLUP: 'E', HID: 'H', HIE: 'H', HIP: 'H', HSD: 'H', HSE: 'H',
  ILU: 'I', PRØ: 'P', PR0: 'P', PRZ: 'P', TRY: 'W',
};

// Nucleotides, also as 5' and 3' terminal residues
const NUCLEOTIDES = {
  DA: 'A', DC: 'C', DG: 'G', DT: 'T', T: 'T', RA: 'A', RC: 'C', RG: 'G', RU: 'U', U: 'U', A: 'A', C: 'C', G: 'G',
};
const NUCLEIC_LETTERS = {
  ...Object.fromEntries(Object.entries(NUCLEOTIDES).flatMap(([name, letter]) =>
    [[name, letter], [name + '5', letter], [name + '3', letter]])),
  ADE: 'A', CYT: 'C', GUA: 'G', THY: 'T', URA: 'U',
};

const RESIDUE_LETTERS = { ...PROTEIN_LETTERS, ...NUCLEIC_LETTERS };

module.exports = { RESIDUE_LETTERS };
