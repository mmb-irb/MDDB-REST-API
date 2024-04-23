const rootRouter = require('express').Router();
// API generic handler
const handler = require('../../utils/generic-handler');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');
const availableReferences = Object.keys(REFERENCES).join(', ');
// Standard codes for HTTP responses
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');

// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection = process.env.NODE_ENV === 'test'
    ? require('../../../test-helpers/mongo/index')
    : require('../../models/index');

// Set the response when a specific reference is requested
// Return a list with all available reference ids
const wholeReferenceResponse = handler({
    async retriever(request) {
        // Save the mongo database connection
        const client = await dbConnection;
        // Access the database
        const db = client.db(process.env.DB_NAME);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        const reference = REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${availableReferences}`
        };
        // Set the target mongo collection
        const collection = db.collection(reference.collectionName);
        // Get all references, but only their reference ids
        const cursor = await collection.find({},
            { projection: { _id: false, [reference.idField]: true } },
        );
        // Consume the cursor
        const references = await cursor.toArray();
        // Get the reference ids in an array
        const referenceIds = references.map(ref => ref[reference.idField]);
        return referenceIds;
    },
    headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
    },
    body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
    },
});

// Set the response when a specific reference id is requested
// Return an the requested reference object
const specificReferenceResponse = handler({
    async retriever(request) {
        // Save the mongo database connection
        const client = await dbConnection;
        // Access the database
        const db = client.db(process.env.DB_NAME);
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        const reference = REFERENCES[referenceName];
        if (!reference) return {
            headerError: NOT_FOUND,
            error: `Unknown reference "${referenceName}". Available references: ${availableReferences}`
        };
        // Set the target mongo collection
        const collection = db.collection(reference.collectionName);
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
    },
    // If no project is found, a NOT_FOUND status is sent in the header
    headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
    },
    // Else, the project object is cleaned (some attributes are renamed or removed) and sent in the body
    body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
    },
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
