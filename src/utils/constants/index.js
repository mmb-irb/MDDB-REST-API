// Import references configuration
const { REFERENCES } = require('mddb-database/utils/constants');

// Set the supported references in "pointers" endpoints
// We exclude chains since it does not make sense, although it should work anyway
const POINTERS_NOT_SUPPORTED_REFERENCES = new Set(['chains']);
const POINTERS_SUPPORTED_REFERENCES = { ...REFERENCES };
POINTERS_NOT_SUPPORTED_REFERENCES.forEach(referenceName => delete POINTERS_SUPPORTED_REFERENCES[referenceName]);

// Amino acid letters
const PROTEIN_RESIDUE_NAME_LETTERS = {
    'ALA':'A',
    'ALAN':'A',
    'ALAC':'A',
    'ARG':'R',
    'ARGN':'R',
    'ARGC':'R',
    'ASN':'N',
    'ASNN':'N',
    'ASNC':'N',
    'ASP':'D',
    'ASPN':'D',
    'ASPC':'D',
    'CYS':'C',
    'CYSN':'C',
    'CYSC':'C',
    'CYH':'C',
    'CSH':'C',
    'CSS':'C',
    'CYX':'C',
    'CYP':'C',
    'GLN':'Q',
    'GLNN':'Q',
    'GLNC':'Q',
    'GLU':'E',
    'GLUN':'E',
    'GLUC':'E',
    'GLUP':'E',
    'GLY':'G',
    'GLYN':'G',
    'GLYC':'G',
    'HIS':'H',
    'HISN':'H',
    'HISC':'H',
    'HID':'H',
    'HIE':'H',
    'HIP':'H',
    'HSD':'H',
    'HSE':'H',
    'ILE':'I',
    'ILEN':'I',
    'ILEC':'I',
    'ILU':'I',
    'LEU':'L',
    'LEUN':'L',
    'LEUC':'L',
    'LYS':'K',
    'LYSN':'K',
    'LYSC':'K',
    'MET':'M',
    'METN':'M',
    'METC':'M',
    'PHE':'F',
    'PHEN':'F',
    'PHEC':'F',
    'PRO':'P',
    'PRON':'P',
    'PROC':'P',
    'PRØ':'P',
    'PR0':'P',
    'PRZ':'P',
    'SER':'S',
    'SERN':'S',
    'SERC':'S',
    'THR':'T',
    'THRN':'T',
    'THRC':'R',
    'TRP':'W',
    'TRPN':'W',
    'TRPC':'W',
    'TRY':'W',
    'TYR':'Y',
    'TYRN':'Y',
    'TYRC':'Y',
    'VAL':'V',
    'VALN':'V',
    'VALC':'V',
}

// Amino acid letters
const PROTEIN_LETTER_RESIDUE_NAMES = {
    'A':'ALA',
    'R':'ARG',
    'N': 'ASN',
    'D': 'ASP',
    'C': 'CYS',
    'Q': 'GLN',
    'E': 'GLU',
    'G': 'GLY',
    'H': 'HIS',
    'I': 'ILE',
    'L': 'LEU',
    'K': 'LYS',
    'M': 'MET',
    'F': 'PHE',
    'P': 'PRO',
    'S': 'SER',
    'T': 'THR',
    'W': 'TRP',
    'Y': 'TYR',
    'V': 'VAL',
    'X': null,
}

// Set some constants
// Structure exporting supported formats, by the name requests use
// The structure endpoint adds the function producing each of them, and accepts 'cif' for mmcif
const STRUCTURE_FORMATS = {
    pdb: { extension: 'pdb', contentType: 'chemical/x-pdb' },
    mmcif: { extension: 'cif', contentType: 'chemical/x-mmcif' },
};

// Trajectory exporting supported formats
const TRAJECTORY_FORMATS = {
    bin: {
        name: 'bin',
        contentType: 'application/octet-stream',
    },
    mdcrd: {
        name: 'mdcrd',
        contentType: 'text/mdcrd',
    },
    xtc: {
        name: 'xtc',
        contentType: 'application/xtc',
        chemfilesName: 'XTC',
        // The whole box matrix is stored, so a rotated box (e.g. after a fit) is kept as is
        includesBox: true,
    },
    trr: {
        name: 'trr',
        contentType: 'application/trr',
        chemfilesName: 'TRR',
        includesBox: true,
    },
    // Streaming NetCDF requires the chemfiles fork to know the number of frames in advance
    // The chemfiles converter sets it from the frame count passed as argument
    nc: {
        name: 'nc',
        contentType: 'application/nc',
        chemfilesName: 'Amber NetCDF',
    },
    // DCD also stores the number of frames in the header, so it is streamed the same way
    dcd: {
        name: 'dcd',
        contentType: 'application/dcd',
        chemfilesName: 'DCD',
    },
};

// List the expected topology fields
const TOPOLOGY_FIELDS = new Set([
    'atom_names',
    'atom_elements',
    'atom_charges',
    'atom_residue_indices',
    'atom_bonds',
    'residue_names',
    'residue_numbers',
    'residue_icodes',
    'residue_chain_indices',
    'chain_names',
    'references',
    'reference_types',
    'residue_reference_indices',
    'residue_reference_numbers',
    'selections',
    'version',
]);

module.exports = {
    // Structural helps
    PROTEIN_RESIDUE_NAME_LETTERS,
    PROTEIN_LETTER_RESIDUE_NAMES,
    // Set a keyword to ask for the reference value in the 'knowledge' endpoint
    KNOWLEDGE_REFERENCE_KEYWORD: 'REFERENCE',
    // Reference types supported in pointers
    POINTERS_SUPPORTED_REFERENCES,
    // Supported formats and fields, which the MCP tools also offer
    STRUCTURE_FORMATS,
    TRAJECTORY_FORMATS,
    TOPOLOGY_FIELDS,
}