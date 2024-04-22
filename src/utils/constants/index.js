// Set some constants
module.exports = {
    STANDARD_TRAJECTORY_FILENAME: 'trajectory.bin',
    STANDARD_STRUCTURE_FILENAME: 'structure.pdb',
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
    }
}