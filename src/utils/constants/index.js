// Import references configuration
const { REFERENCES } = require('mddb-database/utils/constants');

// Set the supported references in "pointers" endpoints
// We exclude chains since it does not make sense, although it should work anyway
const POINTERS_NOT_SUPPORTED_REFERENCES = new Set(['chains']);
const POINTERS_SUPPORTED_REFERENCES = { ...REFERENCES };
POINTERS_NOT_SUPPORTED_REFERENCES.forEach(referenceName => delete POINTERS_SUPPORTED_REFERENCES[referenceName]);

// Amino acid letters
PROTEIN_RESIDUE_NAME_LETTERS = {
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
PROTEIN_LETTER_RESIDUE_NAMES = {
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
module.exports = {
    // Set the headers for some queries
    REFERENCE_HEADER: 'references.',
    // Set the project fields which store dates
    DATE_FIELDS: new Set([ 'updateDate' ]),
    // Structural helps
    PROTEIN_RESIDUE_NAME_LETTERS,
    PROTEIN_LETTER_RESIDUE_NAMES,
    // Set a keyword to ask for the reference value in the 'knowledge' endpoint
    KNOWLEDGE_REFERENCE_KEYWORD: 'REFERENCE',
    // Reference types supported in pointers
    POINTERS_SUPPORTED_REFERENCES,
}