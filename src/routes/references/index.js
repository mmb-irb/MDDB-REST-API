const rootRouter = require('express').Router();
// API generic handler
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');
const availableReferences = Object.keys(REFERENCES).join(', ');
// Standard codes for HTTP responses
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');

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
        // Set the target mongo collection
        const collection = database[referenceName];
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
