// Set the router for further endpoints under references
// Endpoints here may be attended by either the the global or any local API
const referencesRouter = require('express').Router();
// Set the local references router, for endpoints which are to be responded only by local APIs
const referencesLocalRouter = require('express').Router();
// API generic handler
const handler = require('../../utils/generic-handler');
// Parse pagination arguments
const getPagination = require('../../utils/get-pagination');
// Get the database handler
const getDatabase = require('../../database');
// Get auxiliar functions
const { isObjectId, getConfig, getRequestedIds } = require('../../utils/auxiliar-functions');
// Get the filter and return parsers
const { getReferenceFieldResolver, parseFilters, getFilterQuery, parseReturn } = require('../../utils/query-fields');
// Import references configuration
const { REFERENCES } = require('mddb-database/utils/constants');
const AVAILABLE_REFERENCES = Object.keys(REFERENCES).join(', ');
// Standard codes for HTTP responses
const { BAD_REQUEST, NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');

// Get the sorted ids of references matching the query which are covered by the available projects
const getAvailableReferenceIds = async (database, reference, referenceQuery) => {
    // Query references and get only their reference ids
    const referenceCursor = await database[reference.collectionName]
        .find(referenceQuery)
        .project({ _id: false, [reference.idField]: true })
        .map(ref => ref[reference.idField]);
    const referenceIds = await referenceCursor.toArray();
    // WARNING: We must always start from these ids collected from references
    // WARNING: Note that projects may have reference ids for references which do not exist
    // WARNING: Although they shouldn't
    // Get a list with all reference ids which are to be returned according to the available projects
    // Note that less references are to be returned if this is the production API
    const projectsQuery = database.getBaseFilter();
    const distinctResult = await database.projects.distinct(
        reference.projectIdsField, projectsQuery);
    const coveredReferenceIds = new Set(distinctResult);
    // Filter away references which are not covered by the available projects
    const availableReferenceIds = new Set(referenceIds.filter(id => coveredReferenceIds.has(id)));
    // Sort the available reference ids
    return Array.from(availableReferenceIds).sort();
};

// Set the response when a specific reference is requested
// Return a list with all available reference ids
// Note that references may be requested both through GET and POST methods
// POST method was implemented to allow long lists of ids
const wholeReferenceResponse = handler({
    supportedArguments: ['ids', 'filter', 'justids', 'return', 'page', 'limit'],
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        const reference = database.REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${database.AVAILABLE_REFERENCES}`
        };
        // Set the target mongo collection
        const referenceCollection = database[reference.collectionName];
        // Fields are relative to the reference (e.g. 'organism') but aliases of this reference are supported as well
        const fieldResolver = getReferenceFieldResolver(referenceName);
        // Set the reference query from the requested filters, if any
        const parsedFilters = parseFilters(request.query.filter, fieldResolver);
        if (parsedFilters.error) return parsedFilters;
        let referenceQuery = parsedFilters.length > 0 ? { $and: parsedFilters.map(getFilterQuery) } : {};
        // Get the requested reference ids, if any, and add them to the reference query
        const ids = getRequestedIds(request);
        if (ids && ids.error) return ids;
        if (ids) referenceQuery = { $and: [ referenceQuery, { [reference.idField]: { $in: ids } } ] };
        // Get the sorted available reference ids
        const sortedReferenceIds = await getAvailableReferenceIds(database, reference, referenceQuery);
        // Get the number of references to be matched after all
        const referencesCount = sortedReferenceIds.length;
        // Check if we are to return only the available ids
        // If so then there is no need for pagination or returned fields
        // LORE: This was the original behaviour of this endpoint
        const justIds = request.query.justids;
        const returnJustIds = justIds !== undefined && justIds !== 'false';
        if (returnJustIds) return sortedReferenceIds;
        // Otherwise we must paginate and handle possible returned fields
        // Set the projection object for the mongo query
        const returnedFields = parseReturn(request.query.return, fieldResolver);
        if (returnedFields.error) return returnedFields;
        const projector = { _id: false, ...Object.fromEntries(returnedFields.map(field => [ field, true ])) };
        // Do the pagination manually
        // Get the skip (page) and limit of references to be returned
        const pagination = getPagination(request);
        if (pagination.error) return pagination;
        const { skip, limit } = pagination;
        const paginatedReferenceIds = sortedReferenceIds.splice(skip, limit);
        const paginatedReferencesQuery = { [reference.idField]: { $in: paginatedReferenceIds } };
        // Finally, perform the final mongo query
        const cursor = await referenceCollection.find(paginatedReferencesQuery).project(projector);
        // Finally consume the cursor
        const references = await cursor.toArray();
        return { referencesCount, references };
    }
});

// Set the maximum (and default) number of reference versions to be returned per page
// This limit is much greater than in other endpoints since every result is small
const MAX_VERSIONS_LIMIT = 100000;

// Set the response when the versions of all references of a specific type are requested
// Return the number of references and an object with reference ids as keys and their versions as values
const referenceVersionsResponse = handler({
    supportedArguments: ['page', 'limit'],
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        const reference = database.REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${database.AVAILABLE_REFERENCES}`
        };
        // Get the skip (page) and limit of references to be returned
        const pagination = getPagination(request,
            { defaultLimit: MAX_VERSIONS_LIMIT, maxLimit: MAX_VERSIONS_LIMIT });
        if (pagination.error) return pagination;
        const { skip, limit } = pagination;
        // Get the sorted available reference ids and paginate them
        const sortedReferenceIds = await getAvailableReferenceIds(database, reference, {});
        // Get the number of references to be matched after all
        const referencesCount = sortedReferenceIds.length;
        const paginatedReferenceIds = sortedReferenceIds.slice(skip, skip + limit);
        // Get the version of every paginated reference
        const cursor = await database[reference.collectionName]
            .find({ [reference.idField]: { $in: paginatedReferenceIds } })
            .project({ _id: false, [reference.idField]: true, version: true });
        const references = await cursor.toArray();
        // References with no version are set as 0.0.0
        const versions = {};
        references.forEach(ref => versions[ref[reference.idField]] = ref.version || '0.0.0');
        // Return versions in the same order as the sorted reference ids
        const sortedVersions = {};
        paginatedReferenceIds.forEach(id => sortedVersions[id] = versions[id]);
        return { referencesCount, versions: sortedVersions };
    }
});

// Set the response when a specific reference id is requested
// Return an the requested reference object
const specificReferenceResponse = handler({
    supportedArguments: [],
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        // Get the requested id
        const referenceId = request.params.id;
        // Use the handler to get the specified reference data
        return await database.getReferenceData(referenceName, referenceId);
    }
});

// Set the response when a list of files from a specific reference id is requested
const specificReferenceFilesResponse = handler({
    supportedArguments: [],
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        // Get the requested id
        const referenceId = request.params.id;
        // Get the reference data
        const referenceData = await database.getReferenceData(referenceName, referenceId);
        // Iterate the shallowest fields to get the expected files to be available for this reference
        const expectedFiles = [];
        Object.values(referenceData).forEach(value => {
            // Check if the following value is a reference to a file
            if (typeof value !== 'string') return;
            if (!value.startsWith('file:')) return;
            const filename = value.slice(5);
            expectedFiles.push(filename);
        });
        return expectedFiles;
    }
});

// Set the response when a specific file from a specific reference id is requested
const specificReferenceSpecificFileResponse = handler({
    supportedArguments: [],
    async retriever(request) {
        // If the query is an object id itself we refuse it
        // This was before supported but never used
        if (isObjectId(request.params.filename)) return {
            headerError: BAD_REQUEST,
            error: 'Requesting a file by its internal ID is no longer supported'
        };
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Set the bucket, which allows downloading big files from the database
        const bucket = database.bucket;
        // Get the requested filename and reference context
        const referenceName = request.params.reference;
        const referenceId = request.params.id;
        const filename = request.params.filename;
        // Find the file descriptor in the database
        const query = { 'metadata.reftype': referenceName, 'metadata.refid': referenceId, filename };
        const descriptor = await database.files.findOne(query);
        if (!descriptor) return {
            headerError: NOT_FOUND,
            error: `File "${filename}" not found for ${referenceName} "${referenceId}"`
        };
        // Open the read stream from the bucket using the file's internal id
        const stream = bucket.openDownloadStream(descriptor._id);
        return { descriptor, byteSize: descriptor.length, filename: descriptor.filename, stream };
    },
    // Handle the response header
    headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) return response.status(retrieved.headerError);
        // If there is an active stream, send range and length content
        const descriptor = retrieved.descriptor;
        const contentRanges = [`bytes=*/${descriptor.length}`];
        if (descriptor.metadata.frames) {
            contentRanges.push(`frames=*/${descriptor.metadata.frames}`);
        }
        if (descriptor.metadata.atoms) {
            contentRanges.push(`atoms=*/${descriptor.metadata.atoms}`);
        }
        // NEVER FORGET: 'content-range' where disabled and now this data is got from project files
        // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
        //response.set('content-range', contentRanges);
        response.set('content-length', retrieved.byteSize);
        // Send content type also if known
        if (descriptor.contentType) {
            response.set('content-type', descriptor.contentType);
        }
        // Set the output filename
        response.setHeader('Content-disposition', `attachment; filename=${retrieved.filename}`);
    },
    // Handle the response body
    body(response, retrieved, request) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // If the client has aborted the request before the streams starts, destroy the stream
        if (request.aborted) {
            retrieved.stream.destroy();
            return;
        }
        // If there is a retrieved stream, start sending data through the stream
        // Resume when the response drains instead of using write callbacks
        // The compression middleware does not call write callbacks, which would stall the stream
        // A single listener is used since 'once' listeners are not removed while compressing
        response.on('drain', () => retrieved.stream.resume());
        retrieved.stream.on('data', data => {
            // Pause until the response drains (see the 'drain' listener above)
            if (!response.write(data)) retrieved.stream.pause();
        });
        // If there is an error, send the error to the console and end the data transfer
        retrieved.stream.on('error', error => {
            console.error(error);
            response.end();
        });
        // Close the response when the read stream has finished
        retrieved.stream.on('end', data => response.end(data));
        // Close the stream when the request is closed
        request.on('close', () => retrieved.stream.destroy());
    },
});

// Set the routing
referencesRouter.route('/').get((_, response) => {
    // Return a message with all possible routes
    // This is just a map so the API user know which options are available
    response.json(`Available reference endpoints: ${AVAILABLE_REFERENCES}`);
});
referencesRouter.route('/:reference').get(wholeReferenceResponse).post(wholeReferenceResponse);
// Note that this route must be set before the specific reference id route
referencesRouter.route('/:reference/versions').get(referenceVersionsResponse);
referencesRouter.route('/:reference/:id').get(specificReferenceResponse);
referencesRouter.route('/:reference/:id/files').get(specificReferenceFilesResponse);
// Note that this endpoint is to be attended by the local rounter only
// This is handled belowe
referencesLocalRouter.route('/:reference/:id/files/:filename').get(specificReferenceSpecificFileResponse);

// If we are using the global API then any further query is mapped to the corresponding database
// Set a handler to be used for both GET and POST methods
const redirectHandler = handler({
    // Arguments are checked by the API the request is redirected to
    supportedArguments: null,
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        // Get the requested id
        const referenceId = request.params.id;
        // Get the reference data
        const referenceData = await database.getReferenceData(referenceName, referenceId);
        if (referenceData.error) return referenceData;
        // Get the reference configuration
        const referenceConfig = database.REFERENCES[referenceName];
        // Find one database where this reference should be present
        // Note that a reference may be duplicated in different nodes
        // However all of them should do the job, although they may be not identical
        // We must attempt to ask a node which will have the most updated version
        // To do so, find the most recently updated project including this reference
        // Then redirect to its node
        const projectsCursor = await database.projects
            .find({ [referenceConfig.projectIdsField]: referenceId })
            .sort({ updateDate: -1 })
            .project({ node: true });
        // Get the first result
        const newestProject = await projectsCursor.next();
        const nodeAlias = newestProject.node;
        if (!nodeAlias) return {
            headerError: INTERNAL_SERVER_ERROR,
            error: `The "${referenceName}" reference "${referenceId}" is missing the node field.`
        };
        // Get the corresponding node
        const node = await database.getNode(nodeAlias);
        if (node.error) return node;
        // Get url path removing the first slash
        const urlPath = request.originalUrl.substring(1);
        // Build the new forwarded URL using the corresponding node API url
        const forwardedRef = node.apiUrl + urlPath;
        // The response code must change depending on the request method
        let code;
        if (request.method === 'GET') code = 302;
        else if (request.method === 'POST') code = 307;
        else throw new Error(`Unsupported method ${request.method}`);
        return { code, url: forwardedRef };
    },
    // Handle the response body
    body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.redirect(retrieved.code, retrieved.url);
    },
});

// Now depending on the request host:
// Redirect to children routes if this is a local request
// Redirect to other APIs if this is a global request
const hostRedirection = (request, response, next) => {
    // Find out if the request host is configured as global
    const config = getConfig(request);
    const isGlobal = config && config.global;
    // Redirect accordingly
    if (isGlobal) return redirectHandler(request, response, next);
    return referencesLocalRouter(request, response, next)
};

referencesRouter.route('/:reference/:id/files/:filename').get(hostRedirection);

module.exports = referencesRouter;

