const rootRouter = require('express').Router();
// API generic handler
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');
// Standard codes for HTTP responses
const { BAD_REQUEST } = require('../../utils/status-codes');
// Import auxiliar functions
const { getValueGetter } = require('../../utils/auxiliar-functions');
// Set the supported references
// We exclude chains since it does not make sense, although it should work anyway
const SUPPORTED_REFERENCES = [ ...Object.keys(REFERENCES) ]
    .filter(value => value !== 'chains');
const availableReferences = SUPPORTED_REFERENCES.join(', ');
// Set which references support "coverage"
// These are references to be residue-assigned in the topology
// Thus PDB references do not support coverage
const COVERAGE_SUPPORTED_REFERENCES = [ 'proteins', 'ligands' ];
// Set a list of supported formats
const SUPPORTED_FORMATS = ['json', 'csv'];
const availableFormats = SUPPORTED_FORMATS.join(', ');

// Set the response when a specific reference is requested
// Return a list with all available reference ids
const wholeReferenceResponse = handler({
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
        const idsField = reference.projectIdsField;
        // Set a getter function for the project reference ids field
        const projectIdsGetter = getValueGetter(idsField);
        // Set an object with all the parameters to perform the mongo projects query
        // Start filtering by published projects only if we are in production environment
        const projectsFinder = database.getBaseFilter();
        // Make sure the projects we query have the ids field and at least one value
        projectsFinder[idsField] = { $exists: true, $type: 'array', $ne: [] };
        // Set which data is to be return from the query
        // We only need the reference id and the project accession
        const projectsProjector = { projection: {
            _id: true, accession: true, [idsField]: true
        }};
        // Set the projects cursor
        const projectsCursor = await database.projects.find(projectsFinder, projectsProjector);
        // Consume the projects cursor
        const projectsData = await projectsCursor.toArray();
        // Check if the requested reference supports 
        const supportedCoverage = COVERAGE_SUPPORTED_REFERENCES.includes(referenceName);
        // If coverage is supported then we must download topologies as well
        const projectTopologies = {};
        if (supportedCoverage) {
            // Set which data is to be return from the query
            // We only need the references and residue reference indices
            const topologiesProjector = { projection: {
                project: true, references: true, residue_reference_indices: true
            }};
            // Set the projects cursor
            const topologiesCursor = await database.topologies.find({}, topologiesProjector);
            // Consume the projects cursor
            const topologiesData = await topologiesCursor.toArray();
            // Restructure data by setting the projects as keys
            topologiesData.forEach(topology => projectTopologies[topology.project] = topology);
        }
        // Classify data per reference id
        const pointers = {};
        // Iterate projects data
        projectsData.forEach(projectData => {
            // Get all reference ids included in this project
            const referenceIds = projectIdsGetter(projectData);
            // Get the topology, in case there is a topology
            // If coverage is supported then proceed to calculate it
            const topology = projectTopologies[projectData._id];
            // Iterate these reference ids
            referenceIds.forEach(referenceId => {
                // Get the current point
                let currentPointer = pointers[referenceId];
                // Create a new one if this is the first time we search for the current reference id
                if (!currentPointer) {
                    currentPointer = { projects : [] };
                    if (supportedCoverage) currentPointer.coverages = [];
                    pointers[referenceId] = currentPointer;
                }
                // Add the id to the list
                currentPointer.projects.push(projectData.accession);
                // If coverange is not supported then we are done
                if (!supportedCoverage) return;
                // Make sure the topology is not lacking essential fields
                if (!topology || !topology.references || !topology.residue_reference_indices) {
                    currentPointer.coverages.push(null);
                    return;
                }
                // If coverage is supported then proceed to calculate it
                const referenceIndex = topology.references.indexOf(referenceId);
                const residueCount = topology.residue_reference_indices.reduce(
                    (acc, index) => acc += index === referenceIndex, 0);
                const coverage = residueCount / topology.residue_reference_indices.length;
                currentPointer.coverages.push(coverage);
            });
        });
        // If there is no output format then return the response as is
        if (format === 'json') return pointers;
        // At this point (for now) it means the requested format is CSV
        let csvData = `${reference.idField}, project accession`;
        if (supportedCoverage) csvData += `,coverage`;
        csvData += '\r\n';
        Object.entries(pointers).forEach(([referenceId, pointerData]) => {
            pointerData.projects.forEach((accession, a) => {
                csvData += `${referenceId},${accession}`;
                if (supportedCoverage) {
                    const coverage = pointerData.coverages[a];
                    csvData += `,${coverage}`;
                }
                csvData += '\r\n';
            });
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
rootRouter.route('/:reference').get(wholeReferenceResponse);

module.exports = rootRouter;
