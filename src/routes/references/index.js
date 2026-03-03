const rootRouter = require('express').Router();
// API generic handler
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');
const availableReferences = Object.keys(REFERENCES).join(', ');
// Standard codes for HTTP responses
const { BAD_REQUEST, NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');

// Set the response when a specific reference is requested
// Return a list with all available reference ids
const wholeReferenceResponse = handler({
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        const reference = REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${availableReferences}`
        };        
        // Get a list with all reference ids which are to be returned according to the available projects
        // Note that less references are to be returned if this is the production API
        const projectQuery = database.getProjectQuery();
        const distinctResult = await database.projects.distinct(
            reference.projectIdsField, projectQuery);
        let availableReferenceIds = new Set(distinctResult);
        // Get the number of references to be matched with the current query
        const referencesCount = availableReferenceIds.length;
        // Set the target mongo collection
        const collection = database[referenceName];
        // Get the requested query, if any
        const query = request.query.query;
        // If a query was passed then filter references and get the remaining reference ids
        if (query) {
            // Parse the query
            const parsedQuery = JSON.parse(query);
            // Query all references and get only their reference ids
            const cursor = await collection.find(parsedQuery)
                .project({ _id: false, [reference.idField]: true });
            const filteredReferenceIds = new Set(cursor.map(ref => ref[reference.idField]));
            // Keep only reference ids which are both available and filtered
            availableReferenceIds = availableReferenceIds.intersection(filteredReferenceIds);
        }
        // Sort the available reference ids
        const sortedReferenceIds = Array.from(availableReferenceIds).sort();
        // Check if we are to return only the available ids
        // If so then there is no need for pagination or projections
        // LORE: This was the original behaviour of this endpoint
        const justIds = request.query.justids;
        const returnJustIds = justIds !== undefined && justIds !== 'false';
        if (returnJustIds) return sortedReferenceIds;
        // Otherwise we must paginate and handle possible projections
        // Set the projection object for the mongo query
        const projector = { _id: false };
        // Handle when it is a mongo projection itself
        // Note that when a projection is requested the project data is not formatted
        let projection = request.query.projection;
        if (projection) {
            // In case there is a single query it would be a string, not an array, so adapt it
            if (typeof projection === 'string') projection = [projection];
            for (const p of projection) {
                // Parse the string into a json object
                const objectProjection = parseJSON(p);
                if (!objectProjection) return {
                    headerError: BAD_REQUEST,
                    error: `Projection "${p}" is not well formatted`
                };
                // Append the specified projection to the projector object
                Object.assign(projector, objectProjection);
            }
        }
        // Do the pagination manually
        // Get the skip (page) and limit of references to be returned
        // If the query has no limit then use a defualt value
        // If the query limit is grater than the limit then set it as the limit
        // If the limit is negative (which makes not sense) it is set to 0
        // This is defined in the src/server/index.js script
        const skip = request.skip;
        const limit = request.query.limit; // The limit will never be greater than 100
        const paginatedReferenceIds = sortedReferenceIds.splice(skip, limit);
        const paginatedReferencesQuery = { [reference.idField]: { $in: paginatedReferenceIds } };
        // Finally, perform the final mongo query
        const cursor = await collection.find(paginatedReferencesQuery).project(projector);
        // Finally consume the cursor
        const references = await cursor.toArray();
        return { referencesCount, references };
    }
});

// Set the response when a specific reference id is requested
// Return an the requested reference object
const specificReferenceResponse = handler({
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        const reference = REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${availableReferences}`
        };
        // Set the target mongo collection
        const collection = database[referenceName];
        // Get the requested id
        const referenceId = request.params.id;
        // Return the reference which matches the request id
        const result = await collection.findOne(
            // Set the query
            { [reference.idField]: referenceId },
            // Set the projection
            { projection: { _id: false } }
        );
        // If there was no result then raise a not found error
        if (!result) return {
            headerError: NOT_FOUND,
            error: `Not found "${referenceName}" reference with id "${referenceId}"`
        };
        return result;
    }
});

// Set the routing
rootRouter.route('/').get((_, response) => {
    // Return a message with all possible routes
    // This is just a map so the API user know which options are available
    response.json(`Available reference endpoints: ${availableReferences}`);
});
rootRouter.route('/:reference').get(wholeReferenceResponse);
rootRouter.route('/:reference/:id').get(specificReferenceResponse);

module.exports = rootRouter;
