// Set some constants
module.exports = {
    // Standard filenames
    STANDARD_TRAJECTORY_FILENAME: 'trajectory.bin',
    STANDARD_STRUCTURE_FILENAME: 'structure.pdb',
    // Set every reference configuration
    REFERENCES: {
        proteins: {
            collectionName: 'references',
            idField: 'uniprot',
            projectIdsField: 'metadata.REFERENCES'
        },
        ligands: {
            collectionName: 'ligands',
            idField: 'pubchem',
            projectIdsField: 'metadata.LIGANDS'
        }
    },
    // Set the header for reference queries
    REFERENCE_HEADER: 'references.'
}