const rootRouter = require('express').Router();
// API generic handler
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');
// Standard codes for HTTP responses
const { INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');
// Import auxiliar functions
const { getValueGetter } = require('../../utils/auxiliar-functions');
// Set the csv separator
const UNIPROT_SEP = '\t';
// Set forbidden reference value
// These values will be excluded from the results when encountered
const FORBIDDEN_REFERENCES = new Set([ undefined, 'noref', 'notfound' ]);

// Set the response when a specific reference is requested
// Return a list with all available reference ids
const uniprotEndpoint = handler({
    async retriever(request) {
        // Stablish database connection and retrieve our custom handler
        const database = await getDatabase(request);
        // Get the proteins reference configuration
        const reference = REFERENCES['proteins'];
        // Set a getter function for the project reference ids field
        const idsField = reference.projectIdsField;
        const projectIdsGetter = getValueGetter(idsField);
        // Set an object with all the parameters to perform the mongo projects query
        // Start filtering by published projects only if we are in production environment
        const projectsFinder = database.getBaseFilter();
        // Make sure the projects we query have the ids field and at least one value
        // If we have a target id the query only those projects which contain this specific id
        projectsFinder[idsField] = { $exists: true, $type: 'array', $ne: [] };
        // Set which additional data is to be return from the query
        const metadataProjections = ['metadata.METHOD', 'metadata.FRAMESTEP'];
        // We only need the reference id and the project accession
        const projectsProjector = { _id: true, accession: true, [idsField]: true };
        metadataProjections.forEach(field => projectsProjector[field] = true)
        // Set the projects cursor
        const projectsCursor = await database.projects.find(projectsFinder).project(projectsProjector);
        // Consume the projects cursor
        const projectsData = await projectsCursor.toArray();
        // If no projects were found then something is wrong (or the databse is empty)
        if (projectsData.length === 0) return {
            headerError: INTERNAL_SERVER_ERROR,
            error: `No projects were found`
        }
        // Set projected field value getters for later
        const projectionValueGetters = Object.fromEntries(
            metadataProjections.map(field => [ field, getValueGetter(field) ])
        ) 
        // If presence is supported then we must download topologies as well
        const projectTopologies = {};
        // Set which data is to be return from the query
        // We only need the references and residue reference indices
        const topologiesProjector = { projection: {
            project: true, references: true,
            residue_reference_indices: true,
            residue_chain_indices: true,
            chain_names: true
        }};
        // Set the projects cursor
        const topologiesCursor = await database.topologies.find({}, topologiesProjector);
        // Consume the projects cursor
        const topologiesData = await topologiesCursor.toArray();
        // Restructure data by setting the projects as keys
        topologiesData.forEach(topology => projectTopologies[topology.project] = topology);

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
                // Add additional projected fields
                metadataProjections.forEach(field => {
                    currentPointer[field] = projectionValueGetters[field](projectData);
                });
                // If there is no topology at all we stop here
                // This should never happen, but you never know
                if (noTopology) return;
                // Get indices of reference residues in the system
                const referenceIndex = topology.references.indexOf(referenceId);
                const referenceResidueIndicies = topology.residue_reference_indices
                    .map((refIndex, index) => refIndex === referenceIndex ? index : null)
                    .filter(i => i != null);
                // Get chains covered by the reference
                const chainIndices = referenceResidueIndicies.map(
                    residue_index => topology.residue_chain_indices[residue_index]);    
                const uniqueChainIndices = [...new Set(chainIndices)];
                const chainNames = uniqueChainIndices.map(chainIndex => topology.chain_names[chainIndex]);
                // At this point they should be unique but some old topologies have repeated chains
                currentPointer.chains = [...new Set(chainNames)].sort();
            });
        });

        let response = '';
        // Iterate entries
        Object.entries(pointers).forEach(([referenceId, pointers]) => {
            pointers.forEach(pointer => {
                response += `${referenceId}${UNIPROT_SEP}${pointer.id}${UNIPROT_SEP}`;
                response += `${pointer['metadata.METHOD'] || 'NA'}${UNIPROT_SEP}`;
                response += `${pointer['metadata.FRAMESTEP'] || 'NA'}${UNIPROT_SEP}`;
                response += `${pointer.chains.join(',')}\n`;
            });
        });
        // Return the formated response
        return response;
    },
    // Handle the response header
    headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) return response.status(retrieved.headerError);
        // Set response header for length and type
        response.set('content-length', retrieved.length * 4);
        response.set('content-type', 'text/plain');
    },
    // Handle the response body
    body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Otherwise the response has been converted to another file format
        response.send(retrieved);
    },
});

// Set the routing
rootRouter.route('/').get(uniprotEndpoint);

module.exports = rootRouter;
