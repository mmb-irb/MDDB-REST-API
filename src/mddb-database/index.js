// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const databaseConnection = process.env.NODE_ENV === 'test'
    ? require('./utils/fake-mongo')
    : require('./utils/connect-mongo');

// Import collections configuration
const {
    LOCAL_COLLECTIONS,
    GLOBAL_COLLECTIONS,
    REFERENCES,
    STANDARD_TRAJECTORY_FILENAME,
    STANDARD_STRUCTURE_FILENAME,
} = require('./utils/constants');

// Import auxiliar functions
const { areObjectsIdentical } = require('./utils/auxiliar');

// Import additional functions
const countOptions = require('./utils/count-options');

// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket } = require('mongodb');

// Set the database handler class
class Database {
    constructor (client, isGlobal) {
        if (!client) throw new Error('No client');
        if (isGlobal !== false && isGlobal !== true)
            throw new Error('The "isGlobal" argument must be either true or false.');
        // Store inputs
        this.client = client;
        this.isGlobal = isGlobal;
        // Get the mongo specific database
        this.db = this.client.db(process.env.DB_NAME);
        // Set the mongo collections depending of it we are aiming for the global database
        this.COLLECTIONS = this.isGlobal ? GLOBAL_COLLECTIONS : LOCAL_COLLECTIONS;
        // Set all collections as values of the database itself
        for (const [ collectionKey, collectionConfig ] of Object.entries(this.COLLECTIONS)) {
            this[collectionKey] = this.db.collection(collectionConfig.name);
        }
        // Save additional constants just to have them available more easily
        this.STANDARD_TRAJECTORY_FILENAME = STANDARD_TRAJECTORY_FILENAME;
        this.STANDARD_STRUCTURE_FILENAME = STANDARD_STRUCTURE_FILENAME;
        // Get the available references in a single string, which may be used for logs
        this.REFERENCES = REFERENCES;
        this.AVAILABLE_REFERENCES = Object.keys(this.REFERENCES).join(', ');
        // Save some internal values
        this._bucket = undefined;
    };

    // Get the grid fs bucket
    get bucket () {
        // Return the internal value if it is already declared
        if (this._bucket !== undefined) return this._bucket;
        // Instantiate the bucket otherwise
        this._bucket = new GridFSBucket(this.db);
        return this._bucket;
    }

    // Setup the database by creating and indexing the configured collections
    // This function is shared by the loader and the monitor
    setup = async () => {
        // Check the collections already existing in the database
        const currentCollections = await this.db.listCollections().toArray()
        const currentCollectionNames = currentCollections.map(collection => collection.name);
        // Iterate over the configured collections
        for await (const [collectionKey, collectionConfig] of Object.entries(this.COLLECTIONS)) {
            // If the collection already exists then do nothing
            if (currentCollectionNames.includes(collectionConfig.name)) {
                // Get the configuration indexes for this collection
                const configIndexes = collectionConfig.indexes;
                // If there are no configuration indexes at all then we are done
                if (!configIndexes) continue;
                // Get the current collection indexes
                const currentIndexesData = await this[collectionKey].indexes();
                const currentIndexes = currentIndexesData.map(indexData => indexData.key);
                // Iterate the expected indexes
                for await (const configIndex of configIndexes) {
                    // Make sure the index exists among the current indexes
                    let found = false;
                    for (const collectionIndex of currentIndexes) {
                        // Compare indices
                        if (areObjectsIdentical(collectionIndex,  configIndex)) {
                            found = true;
                            break;
                        }
                    }
                    // If the index does not exist then we create it
                    if (!found) {
                        console.log(`🛠️  Setting a missing index in "${collectionKey}" collection: ${JSON.stringify(configIndex)}`);
                        await this[collectionKey].createIndex(configIndex);
                    }
                }
                // Proceed to the next collection
                continue;
            }
            console.log(`🛠️  Setting up ${collectionKey} collection`);
            // Create the collection
            await this.db.createCollection(collectionConfig.name);
            // Set some indices if specified to accelerate specific queries
            if (collectionConfig.indexes) {
                for await (const index of collectionConfig.indexes) {
                    await this[collectionKey].createIndex(index);
                }
            }
        }
    };

    // Add additional functions
    countOptions = (query, fields, shouldCountMds) => countOptions(this, query, fields, shouldCountMds);

    // Close the connection to mongo and delete this handler
    close = () => {
        this.client.close();
        delete this;
    }
}

module.exports = {
    databaseConnection,
    Database,
}