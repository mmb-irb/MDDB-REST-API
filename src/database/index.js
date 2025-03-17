// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection = process.env.NODE_ENV === 'test'
    ? require('../../test-helpers/mongo/index')
    : require('../models/index');

// Import collections configuration
const {
    LOCAL_COLLECTION_NAMES,
    GLOBAL_COLLECTION_NAMES,
    REFERENCES
} = require('../utils/constants');
const AVAILABLE_REFERENCES = Object.keys(REFERENCES).join(', ');
// Get a function to clean raw project data to a standard format
const projectFormatter = require('../utils/project-formatter');
// Get auxiliar functions
const { getConfig } = require('../utils/auxiliar-functions');
// Standard HTTP response status codes
const { NOT_FOUND, BAD_REQUEST } = require('../utils/status-codes');
// The project class is used to handle database data from a specific project
const Project = require('./project');

// ObjectId returns an object with the mongo object id
// This id is associated to the provided idOrAccession when it is valid
// When the idOrAccession is not valid for mongo it just returns the same idOrAccession
// In addition, it returns the provided filters
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { ObjectId, GridFSBucket } = require('mongodb');

// Set a function to check if a string is a mongo internal id
// WARNING: Do not use the builtin 'ObjectId.isValid'
// WARNING: It returns true with whatever string 12 characters long
const isObjectId = string => /^[a-z0-9]{24}$/.test(string);

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
        // Save some internal values
        this._bucket = undefined;
        this._requestedMdIndex = undefined;
    };

    // Get the grid fs bucket
    get bucket () {
        // Return the internal value if it is already declared
        if (this._bucket !== undefined) return this._bucket;
        // Instantiate the bucket otherwise
        this._bucket = new GridFSBucket(this.db);
        return this._bucket;
    }

    // Join the published filter, the collection filter and the posited filter in one single filter
    getBaseFilter = () => {
        // Check if it is a production API
        const isProduction = this.config.production;
        // Set the published filter according to the enviornment (.env file)
        // If the environment is tagged as "production" only published projects are returned from mongo
        const publishedFilter = Object.seal(isProduction ? { published: true } : {});
        // Check if it is a global API
        const isGlobal = this.config && this.config.global;
        // Set a filter for the global API to not return unposited projects
        // Note that a non global API is not expected to have this field so it makes not sense applying the filter
        const positedFilter = Object.seal(isGlobal ? { unposited: { $exists: false } } : {});
        // Set the collection filter according to the request URL
        // This filter is applied over the project metadata 'collections', nothing to do with mongo collections
        // Note that unknown hosts (e.g. 'localhost:8000') will get all simulations, with no filter
        const hostCollection = this.config && this.config.collection;
        const collectionFilter = Object.seal(hostCollection ? { 'metadata.COLLECTIONS': hostCollection } : {});
        // Return all filters together, including also the publsihed filter
        return { ...publishedFilter, ...positedFilter, ...collectionFilter };
    };

    // Given the API request, set the project(s) query by the following steps:
    // 1 - Set a published filter according to if it we are in a development or production environment
    // 2 - Set a collection filter based on the origin of the call
    // 3 - Set a project and md filter based on the id or accession in the request
    getProjectQuery = () => {
        // Add the base filter to the query
        const query = { ...this.getBaseFilter() };
        // Get the project id or accession
        const idOrAccession = this.request.params.project;
        if (!idOrAccession) return new Error('No project ir or accession in the request');
        const project = idOrAccession.split('.')[0];
        // Check if the idOrAccession is a mongo internal object id
        if (isObjectId(project)) {
            // Check if it is a global API
            const isGlobal = this.config && this.config.global;
            // If so, we must complain
            if (isGlobal) return new Error('Internal identifiers are not supported by the global API');
            query._id = ObjectId(project);
        }
        // Otherwise we asume it is an accession
        else query.accession = project;
        // Return the query
        return query;
    };

    // Find the requested MD index
    // Note that it may be different from the actual MD index since the requested may be null
    // This parameters is saved and reused because it mya be called by different sources in a single API call
    get requestedMdIndex () {
        // If we already have an internal value then return it
        if (this._requestedMdIndex !== undefined) return this._requestedMdIndex;
        // Otherwise we must get the value
        // Get the requested accession or project id
        const idOrAccession = this.request.params.project;
        // Extract the MD number, if any
        // If there is no MD number in the requets then return null
        const splits = idOrAccession.split('.');
        if (splits.length < 2) return null;
        const mdNumber = +splits[1];
        // If the second split is not parsable to a number then the request is wrong
        if (isNaN(mdNumber)) return new Error('MD number must be numeric');
        // The MD number is 1-based, so if it is 0 then the request is wrong
        if (mdNumber <= 0) return new Error('MD number must be greater than 0');
        // Get the MD index by substracting 1 to the MD number
        // Save the MD index and return it
        this._requestedMdIndex = mdNumber - 1;
        return this._requestedMdIndex;
    };

    // Get project data as is in the database
    // Here data includes all MDs
    getRawProjectData = async (projection = {}) => {
        // Set the project query for the database according to the request parameters
        const projectQuery = this.getProjectQuery();
        // If something went wrong with the project request then return the error
        if (projectQuery instanceof Error) return {
            headerError: BAD_REQUEST,
            error: projectQuery.message
        };
        // Get project data from the database
        const rawProjectData = await this.projects.findOne(projectQuery, { projection });
        // If we did not found the project then stop here
        if (!rawProjectData) return {
            headerError: NOT_FOUND,
            error: `Project ${this.request.params.project} was not found`
        };
        return rawProjectData;
    }

    // Get project data properly formatted
    // Here data belongs to a specific MD
    getProjectData = async () => {
        // Get project raw data
        const rawProjectData = await this.getRawProjectData();
        // If something went wrong when requesting raw data then stop here
        if (rawProjectData.error) return rawProjectData;
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = this.requestedMdIndex;
        // If something went wrong with the MD request then return the error
        if (requestedMdIndex instanceof Error) return {
            headerError: BAD_REQUEST,
            error: requestedMdIndex.message
        };
        // Return the formatted data
        return projectFormatter(rawProjectData, requestedMdIndex);
    }

    // Get project data properly formatted
    // If there is any problem send informative errors
    getProject = async () => {
        // Get project data
        const projectData = await this.getProjectData();
        // If something went wrong with project data then stop here
        if (projectData.error) return projectData;
        // Return the project handler
        return new Project(projectData, this);
    }

    // Get all ids available in a given reference
    getReferenceAvailableIds = async referenceName => {
        // Get the requested reference configuration
        const reference = REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${AVAILABLE_REFERENCES}`
        };
        // Set the target mongo collection
        const collection = this[referenceName];
        // Get all references, but only their reference ids
        const cursor = await collection.find({},
            { projection: { _id: false, [reference.idField]: true } },
        );
        // Consume the cursor
        const references = await cursor.toArray();
        // Get the reference ids in an array
        const referenceIds = references.map(ref => ref[reference.idField]);
        return referenceIds;
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