// Import the MDDB database handler
const { databaseConnection, Database } = require('mddb-database');
// Get a function to clean raw project data to a standard format
const projectFormatter = require('../utils/project-formatter');
// Get auxiliar functions
const { getConfig, isObjectId } = require('../utils/auxiliar-functions');
// Get reference id query formatters
const {
    pdbIdQueryFormatter,
    referenceIdQueryFormatter,
} = require('../utils/reference-id-query-formatters');
// Get the ping function
const ping = require('../utils/ping');
// Standard HTTP response status codes
const { NOT_FOUND, BAD_REQUEST, INTERNAL_SERVER_ERROR } = require('../utils/status-codes');
// The project class is used to handle database data from a specific project
const Project = require('./project');
// The node class is used to handle database data from a specific node
const Node = require('./node');

// Database.ObjectId returns an object with the mongo object id
// This id is associated to the provided idOrAccession when it is valid
// When the idOrAccession is not valid for mongo it just returns the same idOrAccession
// In addition, it returns the provided filters

// Set the project class
class Database4Api extends Database {
    constructor (client, isGlobal, request, config) {
        super(client, isGlobal);
        // Store inputs
        this.request = request;
        this.config = config;
        // Save some internal values
        this._requestedMdIndex = undefined;
        // Edit some constants to adapt them for the API
        // Add functions to format reference ids
        this.REFERENCES.pdbs.idQueryFormatter = pdbIdQueryFormatter;
    };

    // Join the published filter, the collection filter and the posited filter in one single filter
    getBaseFilter = () => {
        // Check if it is a global API
        const isGlobal = this.config && this.config.global;
        // Check if it is a production API
        const isProduction = this.config.production;
        // Check if there is host collection to aim at
        const hostCollection = this.config && this.config.collection;
        // Set if a specific project id or accession was requested
        const withAccession = Boolean(this.request.params.project);
        // Return the final parsed filter
        return this.getProjectsFilter(isGlobal, isProduction, hostCollection, withAccession);
    };

    // Given the API request, set the project(s) query by the following steps:
    // 1 - Set a published filter according to if it we are in a development or production environment
    // 2 - Set a collection filter based on the origin of the call
    // 3 - Exclude booked or deleted entries unless a specific accession is requested
    // 4 - Set a project and md filter based on the id or accession in the request
    getProjectQuery = () => {
        // Get the project id or accession
        const idOrAccession = this.request.params.project;
        if (!idOrAccession) return new Error('No project id or accession in the request');
        const project = idOrAccession.split('.')[0];
        // Add the base filter to the query
        const query = { ...this.getBaseFilter() };
        // Check if the idOrAccession is a mongo internal object id
        if (isObjectId(project)) {
            // If so, we must complain
            if (this.isGlobal) return new Error('Internal identifiers are not supported by the global API');
            query._id = new this.constructor.ObjectId(project);
        }
        // This is a patch to support finding a project by its global but temporal non-persistent id
        // These IDs have the following format: <node>-<local accession>
        else if (this.isGlobal && project.includes('-')) {
            const splits = project.split('-')
            const node = splits[0];
            const local = splits.slice(1).join('')
            query.$or = [{ accession: project }, { node: node, local: local }];
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
        // If there is a link with the ping flag then run the ping here
        if (rawProjectData.metadata && rawProjectData.metadata.LINKS)
            rawProjectData.metadata.LINKS.forEach(link => {
                if (link.ping) ping(link.url);
            });
        // Return the raw project metadata
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

    // Get a node by its alias
    // If there is any problem send informative errors
    getNode = async nodeAlias => {
        // Get node data from the database
        const nodeData = await this.nodes.findOne({ alias: nodeAlias });
        // If we did not found the node then stop here
        if (!nodeData) return {
            headerError: INTERNAL_SERVER_ERROR,
            error: `Node "${nodeAlias}" not found`
        };
        // Return the node handler
        return new Node(nodeData, this);
    }

    // Get all ids available in a given reference
    getReferenceAvailableIds = async (referenceName, query = {}) => {
        // Get the requested reference configuration
        const reference = this.REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${this.AVAILABLE_REFERENCES}`
        };
        // Set the target mongo collection
        const collection = this[reference.collectionName];
        // Get all references, but only their reference ids
        const cursor = await collection.find(query,
            { projection: { _id: false, [reference.idField]: true } },
        );
        // Consume the cursor
        const references = await cursor.toArray();
        // Get the reference ids in an array
        const referenceIds = references.map(ref => ref[reference.idField]);
        return referenceIds;
    }

    // Get all ids available in a given reference
    getReferenceData = async (referenceName, referenceId) => {
        // Get the requested reference configuration
        const reference = this.REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${this.AVAILABLE_REFERENCES}`
        };
        // Set the target mongo collection
        const collection = this[reference.collectionName];
        // Set the query value to search for the target reference id
        const targetedQuery = referenceIdQueryFormatter(reference, referenceId);
        if (targetedQuery.error) return targetedQuery;
        // Set the target query
        const query = { [reference.idField]: targetedQuery };
        // If something is wrong with the id format then return the error
        if (query.error) return query;
        // Set a projection to get rid of the internal id
        const projection = { projection: { _id: false } };
        // Get the target reference
        const referenceData = await collection.findOne(query, projection);
        // If we did not found the reference then stop here
        if (!referenceData) return {
            headerError: NOT_FOUND,
            error: `Not found "${referenceName}" reference with id "${referenceId}"`
        };
        return referenceData;
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
    const client = await databaseConnection;
    // Get the congif parameters
    const config = getConfig(request);
    const isGlobal = config.global || false;
    // Instantiate the database handler
    return new Database4Api(client, isGlobal, request, config);
};

module.exports = getDatabase