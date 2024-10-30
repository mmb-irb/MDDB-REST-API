// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection = process.env.NODE_ENV === 'test'
    ? require('../../test-helpers/mongo/index')
    : require('../models/index');

// Import collections configuration
const { LOCAL_COLLECTION_NAMES, GLOBAL_COLLECTION_NAMES } = require('../utils/constants');
// Get an automatic mongo query parser based on environment and request
const { getProjectQuery, getMdIndex } = require('../utils/get-project-query');
// Get a function to clean raw project data to a standard format
const projectFormatter = require('../utils/project-formatter');
// Get auxiliar functions
const { getConfig } = require('../utils/auxiliar-functions');
// Standard HTTP response status codes
const { NOT_FOUND, BAD_REQUEST } = require('../utils/status-codes');
// The project class is used to handle database data from a specific project
const Project = require('./project');

// Set the project class
class Database {
    constructor (client, db, request) {
        if (!client) throw new Error('No client');
        if (!db) throw new Error('No database');
        // Store inputs
        this.client = client;
        this.db = db;
        this.request = request;
        // Get host configuration
        this.config = getConfig(request);
        // Check if it is a global API
        this.isGlobal = this.config && this.config.global;
        // Set the collections to be queried
        const collectionNames = this.isGlobal
            ? GLOBAL_COLLECTION_NAMES
            : LOCAL_COLLECTION_NAMES;
        // Set every collection handler
        for (const [collectionAlias, collectionName] of Object.entries(collectionNames)) {
            this[collectionAlias] = db.collection(collectionName);
        }
    };

    // Get project data as is in the database
    // If there is any problem send informative errors
    getRawProjectData = async (projection = {}) => {
        // Find the project from the request
        // Return the project which matches the request accession
        // This is used by several endpoints so do not exclude any data
        const projectQuery = getProjectQuery(this.request);
        const rawProjectData = await this.projects.findOne(projectQuery, { projection });
        // If we did not found the project then stop here
        if (!rawProjectData) return { headerError: NOT_FOUND, error: 'Project was not found' };
        return rawProjectData;
    }

    // Get project data properly formatted
    // If there is any problem send informative errors
    getProjectData = async () => {
        // Get project raw data
        const rawProjectData = await this.getRawProjectData();
        // If something went wrong when requesting raw data then stop here
        if (rawProjectData.error) return rawProjectData;
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = getMdIndex(this.request);
        // If something went wrong with the MD request then return the error
        if (requestedMdIndex instanceof Error) return { headerError: BAD_REQUEST, error: requestedMdIndex.message };
        // Return the formatted data
        return projectFormatter(rawProjectData, requestedMdIndex);
    }

    // Get project data properly formatted
    // If there is any problem send informative errors
    getProject = async () => {
        // Get project raw data
        const rawProjectData = await this.getRawProjectData();
        // If something went wrong when requesting raw data then stop here
        if (rawProjectData.error) return rawProjectData;
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = getMdIndex(this.request);
        // If something went wrong with the MD request then return the error
        if (requestedMdIndex instanceof Error) return { headerError: BAD_REQUEST, error: requestedMdIndex.message };
        // Return the formatted data
        const formattedData = projectFormatter(rawProjectData, requestedMdIndex);
        return new Project(formattedData, this);
    }

    // Close the connection to mongo and delete this handler
    close = () => {
        this.client.close();
        delete this;
    }
}

// Connect to the database
// Then construct and return the database handler
const getDatabase = async request => {
    // Save the mongo database connection
    const client = await dbConnection;
    // Access the database
    const db = client.db(process.env.DB_NAME);
    // Instantiate the database handler
    return new Database(client, db, request);
};

module.exports = getDatabase