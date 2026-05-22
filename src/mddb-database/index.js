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

    // Close the connection to mongo and delete this handler
    close = () => {
        this.client.close();
        delete this;
    }
}

// Connect to the database
// Then construct and return the database handler
const connectToDatabase = async isGlobal => {
    // Save the mongo database connection
    const client = await dbConnection;
    // Instantiate the database handler
    return new Database(client, isGlobal);
};

// Get the database client
// Note that this function is set separatedly and not integrated in the handler since it is async
const getDatabaseClient = async () => {
    const client = await dbConnection;
}

module.exports = {
    databaseConnection,
    Database,
}