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
        // Get the requested query, if any
        const query = request.query.query;
        const parsedQuery = (query && JSON.parse(query)) || {};
        // Check if we are to return only the available ids
        // If so then there is no need for pagination or projections
        // LORE: This was the original behaviour of this endpoint
        const justIds = request.query.justids;
        const returnJustIds = justIds !== undefined && justIds !== 'false';
        if (returnJustIds) return await database.getReferenceAvailableIds(referenceName, parsedQuery);
        // Otherwise we must paginate and handle possible projections
        // Set the projection object for the mongo query
        const projector = {};
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
        // Set the target mongo collection
        const collection = database[referenceName];
        // Get the number of references to be matched with the current query
        const referencesCount = await collection.countDocuments(parsedQuery);
        // Finally, perform the mongo query
        // WARNING: If the query is wrong it will not make the code fail until the cursor in consumed
        // e.g. cursor.toArray()
        const cursor = await collection.find(parsedQuery).project(projector);
        // Handle the pagination
        // Get the limit of references to be returned
        // If the query has no limit then use a defualt value
        // If the query limit is grater than the limit then set it as the limit
        // If the limit is negative (which makes not sense) it is set to 0
        // This is defined in the src/server/index.js script
        let limit = request.query.limit;
        // Finally consume the cursor
        const references = await cursor
            // Avoid the first results when a page is provided in the request (URL)
            .skip(request.skip)
            // Avoid the last results when a limit is provided in the request query (URL)
            .limit(limit)
            // Changes the type from Cursor into Array, then saving data in memory
            .toArray();
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
