// Set the configuration of every mongo collection
// Set local and global collections separatedly since they may use different indexes
// name - Actual name of the collection inside the database
// indexes - Index configuration in the database, for the collections setup
// documentNames - Document names used for displaying only
const LOCAL_COLLECTIONS = {
    projects: {
        name: 'projects',
        indexes: [{ published: 1 }],
        documentNames: { singular: 'project', plural: 'projects' },
    },
    uniprot_refs: {
        name: 'references',
        documentNames: { singular: 'reference', plural: 'references' },
    },
    inchikey_refs: {
        name: 'inchikey_refs',
        documentNames: { singular: 'inchikey', plural: 'inchikeys' },
    },
    pdb_refs: {
        name: 'pdb_refs',
        documentNames: { singular: 'PDB', plural: 'PDBs' },
    },
    chain_refs: {
        name: 'chain_refs',
        documentNames: { singular: 'chain', plural: 'chains' },
    },
    collection_refs: {
        name: 'collection_refs',
        documentNames: { singular: 'collection', plural: 'collections' },
    },
    topologies: {
        name: 'topologies',
        indexes: [{ project: 1 }],
        documentNames: { singular: 'topology', plural: 'topologies' },
    },
    files: {
        name: 'fs.files',
        indexes: [{ 'metadata.project': 1 }],
        documentNames: { singular: 'file', plural: 'files' },
    },
    chunks: {
        name: 'fs.chunks',
        documentNames: { singular: 'chunk', plural: 'chunks' },
    },
    analyses: {
        name: 'analyses',
        indexes: [{ project: 1 }],
        documentNames: { singular: 'analysis', plural: 'analyses' },
    },
    counters: {
        name: 'counters',
        documentNames: { singular: 'counter', plural: 'counters' }
    },
};
const GLOBAL_COLLECTIONS = {
    projects: {
        name: 'global.projects',
        indexes: [{ posited: 1 }, { accession: 1 }, { node: 1, local: 1 }],
        documentNames: { singular: 'project', plural: 'projects' },
    },
    topologies: {
        name: 'global.topologies',
        documentNames: { singular: 'topology', plural: 'topologies' },
    },
    uniprot_refs: {
        name: 'global.references',
        indexes: [{ uniprot: 1 }],
        documentNames: { singular: 'reference', plural: 'references' },
    },
    inchikey_refs: {
        name: 'global.inchikeys',
        indexes: [{ inchikey: 1 }],
        documentNames: { singular: 'inchikey', plural: 'inchikeys' },
    },
    pdb_refs: {
        name: 'global.pdb_refs',
        indexes: [{ id: 1 }],
        documentNames: { singular: 'pdb', plural: 'pdbs' },
    },
    chain_refs: {
        name: 'global.chain_refs',
        documentNames: { singular: 'chain', plural: 'chains' },
    },
    collection_refs: {
        name: 'global.collection_refs',
        documentNames: { singular: 'collection', plural: 'collections' },
    },
    nodes: {
        name: 'global.nodes',
        documentNames: { singular: 'topology', plural: 'topologies' },
    },
    counters: {
        name: 'global.counters',
        documentNames: { singular: 'counter', plural: 'counters' }
    },
    pointers: {
        name: 'pointers',
        documentNames: { singular: 'pointers', plural: 'pointers' }
    }
};

// Set the configuration of every reference collection
// Configuration for local and global collections should be identical
// The 'idField' is the field inside every reference document which stores the reference id
// The 'projectIdsField' is the field inside project documents with a list of reference ids related to the project
const REFERENCES = {
    proteins: {
        collectionName: 'uniprot_refs',
        idField: 'uniprot',
        projectIdsField: 'metadata.REFERENCES'
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

// Set some constants
module.exports = {
    // Export mongo collections
    LOCAL_COLLECTIONS,
    GLOBAL_COLLECTIONS,
    // Export references
    REFERENCES,
    // Standard filenames
    STANDARD_TRAJECTORY_FILENAME: 'trajectory.bin',
    STANDARD_STRUCTURE_FILENAME: 'structure.pdb',
}