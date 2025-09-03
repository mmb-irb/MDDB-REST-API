const rootRouter = require('express').Router();
// API generic handler
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Import references configuration
const { REFERENCES } = require('../../../utils/constants');
// Standard codes for HTTP responses
const { BAD_REQUEST, INTERNAL_SERVER_ERROR, NOT_FOUND } = require('../../../utils/status-codes');
// Set the supported references
// We exclude chains since it does not make sense, although it should work anyway
const SUPPORTED_REFERENCES = [ ...Object.keys(REFERENCES) ]
    .filter(value => value !== 'chains');
const availableReferences = SUPPORTED_REFERENCES.join(', ');
// Set a list of supported formats
const SUPPORTED_FORMATS = ['json', 'csv'];
const availableFormats = SUPPORTED_FORMATS.join(', ');
// Set the csv separator
const SEP = ';';

// Set the response when a specific reference is requested
// Return a list with all available reference ids
const pointerLinksEndpoint = handler({
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Check if a specific output format was requested
        // We will need this later, but if the request is wrong then we can kill the process now
        const format = request.query.format || 'json';
        // Check the format is supported otherwise
        if (!SUPPORTED_FORMATS.includes(format)) return {
            headerError: BAD_REQUEST,
            error: `Not suppoted format "${format}". Available formats: ${availableFormats}`
        };
        // Get the requested reference configuration
        const referenceName = request.params.reference;
        const reference = REFERENCES[referenceName];
        if (!reference) return {
            headerError: BAD_REQUEST,
            error: `Not suppoted reference "${referenceName}". Available references: ${availableReferences}`
        }
        // Check if a specific reference id is requested
        const targetReferenceId = request.params.id;
        const hasTarget = targetReferenceId !== undefined;
        // Get the requesting protocol, host and URL base
        // It will be used to generate the URLs
        const protocol = request.protocol;
        const host = request.get('host');
        // Get from the database all reference ids
        const referencesFinder = targetReferenceId ? { [reference.idField]: targetReferenceId } : {};
        const referencesProjector = { [reference.idField]: true };
        const referencesCursor = await database[referenceName]
            .find(referencesFinder)
            .project(referencesProjector);
        const referencesData = await referencesCursor.toArray();
        // If no references were found then it means some reference id was searched and not found
        if (referencesData.length === 0) return {
            headerError: NOT_FOUND,
            error: targetReferenceId
                ? `No project was found to include references to "${targetReferenceId}" ${referenceName}`
                : `There are no references to ${referenceName} at all`
        }
        const referenceIds = referencesData.map(doc => doc[reference.idField]);
        // Now set the output result
        const response = {};
        referenceIds.forEach(referenceId => {
            // HARDCODE: El host de la query no tiene por que ser el del cliente
            // HARDCODE: De hecho una API podría no tener cliente asociado o tener varios
            const url = `${protocol}://${host}/#/pointer?ref=${referenceName}&id=${referenceId}`;
            response[referenceId] = url;
        })
        // If the response is to be in JSON format then we are done
        if (format === 'json') return response;
        // Otherwise parse it to CSV
        // At this point (for now) it means the requested format is CSV
        // Start with the CSV header
        let csvData = hasTarget ? '' : `${reference.idField}${SEP}`;
        csvData += 'pointers url\r\n';
        // Now add the actual values for each row
        Object.entries(response).forEach(([referenceId, url]) => {
            csvData += hasTarget ? '' : `${referenceId}${SEP}`;
            csvData += `${url}\r\n`;
        });
        return csvData;
    },
    // Handle the response header
    headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) return response.status(retrieved.headerError);
        // If this is the normal retrieve (json format) then it is an object
        if (typeof retrieved === 'object') return;
        // If this is a string then it means this was converted to another format
        // Send file headers so it is downloaded as a file
        response.set('content-length', retrieved.length * 4);
        response.set('content-type', 'text/csv');
        response.setHeader('Content-disposition', `attachment; filename=pointers.csv`);
    },
    // Handle the response body
    body(response, retrieved, request) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // If this is the normal retrieve (json format) then it is an object
        if (typeof retrieved === 'object') return response.json(retrieved);
        // Otherwise the response has been converted to another file format
        response.send(retrieved);
    },
});

// Set the routing
rootRouter.route('/').get((_, response) => {
    // Return a message with all possible routes
    // This is just a map so the API user know which options are available
    response.json(`Available reference endpoints: ${availableReferences}`);
});
rootRouter.route('/:reference').get(pointerLinksEndpoint);
rootRouter.route('/:reference/:id').get(pointerLinksEndpoint);

module.exports = rootRouter;
