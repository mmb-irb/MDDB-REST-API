// Set references here since they are used further to calculate other constants
// Set every reference configuration
const REFERENCES = {
    proteins: {
        collectionName: 'references',
        idField: 'uniprot',
        projectIdsField: 'metadata.REFERENCES'
    },
    ligands: {
        collectionName: 'ligands',
        idField: 'pubchem',
        projectIdsField: 'metadata.LIGANDS'
    },
    inchikeys: {
        collectionName: 'inchikey_refs',
        idField: 'inchikey',
        projectIdsField: 'metadata.INCHIKEYS'
    },
    pdbs: {
        collectionName: 'pdb_refs',
        idField: 'id',
        projectIdsField: 'metadata.PDBIDS'
    },
    chains: {
        collectionName: 'chain_refs',
        idField: 'sequence',
        projectIdsField: 'metadata.PROTSEQ'
    },
    collections: {
        collectionName: 'collection_refs',
        idField: 'id',
        projectIdsField: 'metadata.COLLECTIONS'
    }
};

// Local mongo collection names are for federated nodes
const LOCAL_COLLECTION_NAMES = {
    projects: 'projects',
    topologies: 'topologies',
    analyses: 'analyses',
    files: 'fs.files',
    old_chains: 'chains',
};
// Add local reference collections
Object.entries(REFERENCES).forEach(([referenceName, reference]) => {
    LOCAL_COLLECTION_NAMES[referenceName] = reference.collectionName;
});

// Global mongo collections in names are for the global API only
const GLOBAL_COLLECTION_NAMES = {
    projects: 'global.projects',
    nodes: 'global.nodes',
    topologies: 'global.topologies',
};
// Add global reference collections
Object.entries(REFERENCES).forEach(([referenceName, reference]) => {
    GLOBAL_COLLECTION_NAMES[referenceName] = `global.${reference.collectionName}`;
});

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

// Set some constants
module.exports = {
    // Standard filenames
    STANDARD_TRAJECTORY_FILENAME: 'trajectory.bin',
    STANDARD_STRUCTURE_FILENAME: 'structure.pdb',
    // Export references
    REFERENCES,
    // Set the headers for some queries
    REFERENCE_HEADER: 'references.',
    TOPOLOGY_HEADER: 'topology.',
    // Set the project fields which store dates
    DATE_FIELDS: new Set([ 'updateDate' ]),
    // Export mongo collection names
    LOCAL_COLLECTION_NAMES,
    GLOBAL_COLLECTION_NAMES,
    // Structural helps
    PROTEIN_RESIDUE_NAME_LETTERS,
}