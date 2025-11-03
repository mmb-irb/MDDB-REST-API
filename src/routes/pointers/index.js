const rootRouter = require('express').Router();
// API generic handler
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');
// Standard codes for HTTP responses
const { BAD_REQUEST, INTERNAL_SERVER_ERROR, NOT_FOUND } = require('../../utils/status-codes');
// Import auxiliar functions
const { getValueGetter, getBaseURL } = require('../../utils/auxiliar-functions');
const { rangeNotation } = require('../../utils/parse-query-range');
// Set the supported references
// We exclude chains since it does not make sense, although it should work anyway
const SUPPORTED_REFERENCES = [ ...Object.keys(REFERENCES) ]
    .filter(value => value !== 'chains');
const availableReferences = SUPPORTED_REFERENCES.join(', ');
// Set which references support "presence"
// These are references to be residue-assigned in the topology
// Thus PDB references do not support presence
const PRESENCE_SUPPORTED_REFERENCES = [ 'proteins', 'ligands' ];
// Set which references support "coverage"
// These are references which have multiple residues
// Thus not all of its residues may be covered in the system
// Only proteins so far
const COVERAGE_SUPPORTED_REFERENCES = [ 'proteins' ];
// Set a list of supported formats
const SUPPORTED_FORMATS = ['json', 'csv'];
const availableFormats = SUPPORTED_FORMATS.join(', ');
// Set the csv separator
const SEP = ';';
// A text which may include the spearator character would be splitted
// In order to avoid this, all separators are escaped if they are wrapped in double quotes
const escape = text => text && `"${text}"`;
// Set forbidden reference value
// These values will be excluded from the results when encountered
const FORBIDDEN_REFERENCES = new Set([ undefined, 'noref', 'notfound' ]);

// Set the response when a specific reference is requested
// Return a list with all available reference ids
const pointersEndpoint = handler({
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
        // Set a getter function for the project reference ids field
        const idsField = reference.projectIdsField;
        const projectIdsGetter = getValueGetter(idsField);
        // Set an object with all the parameters to perform the mongo projects query
        // Start filtering by published projects only if we are in production environment
        const projectsFinder = database.getBaseFilter();
        // Make sure the projects we query have the ids field and at least one value
        // If we have a target id the query only those projects which contain this specific id
        projectsFinder[idsField] = hasTarget
            ? targetReferenceId
            : { $exists: true, $type: 'array', $ne: [] };
        // Set which data is to be return from the query
        // We only need the reference id and the project accession
        const projectsProjector = { _id: true, accession: true, [idsField]: true };
        // Get the requested projection
        let projection = request.query.projection || [];
        if (typeof projection === 'string') projection = [projection];
        // Add the requested field to the project projector
        projection.forEach(field => projectsProjector[field] = true);
        // Set the projects cursor
        const projectsCursor = await database.projects.find(projectsFinder).project(projectsProjector);
        // Consume the projects cursor
        const projectsData = await projectsCursor.toArray();
        // If no projects were found then it means some reference id was searched and not found
        if (projectsData.length === 0) return {
            headerError: NOT_FOUND,
            error: targetReferenceId
                ? `No project was found to include references to "${targetReferenceId}" ${referenceName}`
                : `There are no references to ${referenceName} at all`
        }
        // Set projected field value getters for later
        const projectionValueGetters = Object.fromEntries(
            projection.map(field => [ field, getValueGetter(field) ])
        ) 
        // Check if the requested reference supports "presence" measuring
        const supportedPresence = PRESENCE_SUPPORTED_REFERENCES.includes(referenceName);
        // Check if the requested reference supports "coverage" measuring
        const supportedCoverage = COVERAGE_SUPPORTED_REFERENCES.includes(referenceName);
        // If presence is supported then we must download topologies as well
        const projectTopologies = {};
        if (supportedPresence || supportedCoverage) {
            // Set which data is to be return from the query
            // We only need the references and residue reference indices
            const topologiesProjector = { projection: {
                project: true, references: true,
                residue_reference_indices: true,
                residue_reference_numbers: supportedCoverage ? true : undefined,
            }};
            // Set the projects cursor
            const topologiesCursor = await database.topologies.find({}, topologiesProjector);
            // Consume the projects cursor
            const topologiesData = await topologiesCursor.toArray();
            // Restructure data by setting the projects as keys
            topologiesData.forEach(topology => projectTopologies[topology.project] = topology);
        }
        // If coverage is supported then measure hte number of residues in every reference
        const referencesResidueCounts = {};
        if (supportedCoverage) {
            // Now download reference data
            // This is used only to measure the coverage of the reference in the current system
            const collection = database[referenceName];
            // Download the target reference only, or all references if there is not target
            const referencesFinder = hasTarget ? { [reference.idField]: targetReferenceId } : {};
            // Set which field are to be retrieved
            // DANI: This is the only hardcoded part
            // DANI: Since these will always be proteins (so far) I know I want the sequence
            const referencesProjector = { uniprot: true, sequence: true };
            // Query the database
            const referencesCursor = await collection.find(referencesFinder, referencesProjector);
            // Consume the references cursor
            const referencesData = await referencesCursor.toArray();
            // Count the number of residues per references
            referencesData.forEach(ref => referencesResidueCounts[ref.uniprot] = ref.sequence.length);
        }
        // Get the requesting protocol, host and URL base
        // It will be used to generate the URLs
        // WARNING: Note that the URL base may change
        // e.g. in local host it is /rest/... while normally it is /api/rest/...
        const protocol = request.protocol;
        const host = request.get('host');
        const baseURL = getBaseURL(request.originalUrl);
        // DANI: Esto es un arreglo temporal
        // DANI: No hay forma de recuperar la URL original completa desde express
        // DANI: Las queries que vienen de MDposit llevan el '/api' detrás del host name
        // DANI: No tengo forma de recuperar esto desde express, así que hago un arreglo por prisa
        const fix = host.startsWith('localhost') ? '' : '/api';
        // Now set the API projects URL
        const projectsURL = `${protocol}://${host}${fix}${baseURL}/projects/`;
        // Also set the web client URL
        // DANI: Esto tampoco me acaba de gustar
        // DANI: El host de la query no tiene por que ser el del cliente
        // DANI: De hecho una API podría no tener cliente asociado o tener varios
        const webURL = `${protocol}://${host}/#/id/`;
        // Classify data per reference id
        const pointers = {};
        // Iterate projects data
        projectsData.forEach(projectData => {
            const accession = projectData.accession;
            // Get all reference ids included in this project
            const referenceIds = projectIdsGetter(projectData);
            // Get the topology, in case there is a topology
            const topology = projectTopologies[projectData._id];
            // Check if topology is not available
            const noTopology = !topology || !topology.references || !topology.residue_reference_indices;
            // Iterate these reference ids
            referenceIds.forEach(referenceId => {
                // If we have a target reference id then skip anything else
                if (hasTarget && targetReferenceId !== referenceId) return;
                // If the reference id is among the forbidden values then skip it
                if (FORBIDDEN_REFERENCES.has(referenceId)) return;
                // Get the current point
                let currentReferenceIdPointers = pointers[referenceId];
                // Create a new one if this is the first time we search for the current reference id
                if (!currentReferenceIdPointers) {
                    currentReferenceIdPointers = [];
                    pointers[referenceId] = currentReferenceIdPointers;
                }
                // Set the new pointer and add it to the pointers list
                const currentPointer = { id: accession };
                currentReferenceIdPointers.push(currentPointer);
                // Add the full URL to access current project data
                currentPointer.api = projectsURL + accession;
                currentPointer.web = webURL + accession;
                // Add additional projected fields
                projection.forEach(field => {
                    currentPointer[field] = projectionValueGetters[field](projectData);
                });
                // If presence and overage are not supported then we are done
                if (!supportedPresence && !supportedCoverage) return;
                // If there is no topology at all we stop here
                // This should never happen, but you never know
                if (!topology) return;
                // Get indices of reference residues in the system
                const referenceIndex = topology.references.indexOf(referenceId);
                const referenceResidueIndicies = topology.residue_reference_indices
                    .map((refIndex, index) => refIndex === referenceIndex ? index : null)
                    .filter(i => i != null);
                // If presence is supported
                if (supportedPresence) {
                    // Make sure the topology is not lacking essential fields
                    if (noTopology) {
                        currentPointer.present_residues = null;
                        currentPointer.presence = null;
                    }
                    else {
                        // Also set the range of covered residues
                        currentPointer.present_residues = rangeNotation(referenceResidueIndicies);
                        // If presence is supported then proceed to calculate it
                        // Count the total number of residues in the system
                        const systemResidueCount = topology.residue_reference_indices.length;
                        // Count the total number of reference residues in the system
                        const referenceResidueCount = referenceResidueIndicies.length;
                        const presence = referenceResidueCount / systemResidueCount;
                        currentPointer.presence = presence;
                    }
                }
                // If coverage is supported
                if (supportedCoverage) {
                    if (referenceId === 'noref' || referenceId === 'notfound') {
                        currentPointer.covered_residues = null;
                        currentPointer.coverage = null;
                    }
                    else {
                        // Get covered reference residue numbers
                        const referenceResidueNumbers = referenceResidueIndicies.map(
                            residueIndex => topology.residue_reference_numbers[residueIndex]);
                        // Get unique and sorted numbers
                        const coveredResidues = [...new Set(referenceResidueNumbers)];
                        coveredResidues.sort((a,b) => a-b);
                        // Parse it to ranged notation
                        currentPointer.covered_residues = rangeNotation(coveredResidues);
                        // Get the percent of reference residues covered in the system
                        const referenceResidueCount = referencesResidueCounts[referenceId];
                        currentPointer.coverage = coveredResidues.length / referenceResidueCount;
                    }
                }
            });
        });
        // If there is no output format then return the response as is
        if (format === 'json') return hasTarget ? pointers[targetReferenceId] : pointers;
        // At this point (for now) it means the requested format is CSV
        // Start with the CSV header
        let csvData = hasTarget ? '' : `${reference.idField}${SEP}`;
        csvData += `project accession${SEP}api url${SEP}web client url`;
        // Add a label in the header for every projected field
        projection.forEach(field => { csvData += `${SEP}${field}` });
        // If presence or coverage are supported then add their labels in the header
        if (supportedPresence) csvData += `${SEP}present residues${SEP}presence`;
        if (supportedCoverage) csvData += `${SEP}covered residues${SEP}coverage`;
        csvData += '\r\n';
        // Now add the actual values for each row
        Object.entries(pointers).forEach(([referenceId, pointers]) => {
            pointers.forEach(pointer => {
                csvData += hasTarget ? '' : `${referenceId}${SEP}`;
                csvData += `${pointer.id}${SEP}${pointer.api}${SEP}${pointer.web}`;
                projection.forEach(field => { csvData += `${SEP}${escape(pointer[field])}` });
                if (supportedPresence)
                    csvData += `${SEP}${pointer.present_residues}${SEP}${pointer.presence}`;                    
                if (supportedCoverage)
                    csvData += `${SEP}${pointer.covered_residues}${SEP}${pointer.coverage}`;
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
rootRouter.route('/:reference').get(pointersEndpoint);
rootRouter.route('/:reference/:id').get(pointersEndpoint);

module.exports = rootRouter;
