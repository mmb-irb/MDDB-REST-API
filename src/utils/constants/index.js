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
    pdb_refs: {
        collectionName: 'pdb_refs',
        idField: 'id',
        projectIdsField: 'metadata.PDBIDS'
    }
};

// Local mongo collection names are for federated nodes
const LOCAL_COLLECTION_NAMES = {
    projects: 'projects',
    topologies: 'topologies',
    analyses: 'analyses',
    files: 'fs.files',
    chains: 'chains',
};
// Add local reference collections
Object.entries(REFERENCES).forEach(([referenceName, reference]) => {
    LOCAL_COLLECTION_NAMES[referenceName] = reference.collectionName;
});

// Global mongo collections in names are for the global API only
const GLOBAL_COLLECTION_NAMES = {
    projects: 'global.projects',
    nodes: 'global.nodes'
};
// Add global reference collections
Object.entries(REFERENCES).forEach(([referenceName, reference]) => {
    GLOBAL_COLLECTION_NAMES[referenceName] = `global.${reference.collectionName}`;
});

// Set some constants
module.exports = {
    // Standard filenames
    STANDARD_TRAJECTORY_FILENAME: 'trajectory.bin',
    STANDARD_STRUCTURE_FILENAME: 'structure.pdb',
    // Export references
    REFERENCES,
    // Set the header for reference queries
    REFERENCE_HEADER: 'references.',
    // Export mongo collection names
    LOCAL_COLLECTION_NAMES,
    GLOBAL_COLLECTION_NAMES,
}