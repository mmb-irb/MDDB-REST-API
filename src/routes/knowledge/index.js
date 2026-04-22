const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Get auxiliar functions
const { getConfig } = require('../../utils/auxiliar-functions');
// Standard HTTP response status codes
const { NOT_FOUND } = require('../../utils/status-codes');
// Fet a keyword to ask for the reference value, using the original PDB structure
const { KNOWLEDGE_REFERENCE_KEYWORD } = require('../../utils/constants');

const router = Router({ mergeParams: true });

// List the supported analyses with knowledge endpoint
const SUPPORTED_ANALYSES = new Set(['sasa', 'lipid-inter']);

// Root -> display available PDBs
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Return a list with all the available PDB codes
      return database.getReferenceAvailableIds('pdbs');
    }
  }),
);

// A PDB is passed -> display available projects for this PDB id
router.route('/:pdbid').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Count the amount of projects including the target PDB id
      const pdbId = request.params.pdbid;
      const projectsQuery = { 'metadata.PDBIDS': pdbId };
      const projectsCount = await database.projects.countDocuments(projectsQuery);
      // If there are no projects at all then re
      if (projectsCount === 0) return {
        headerError: NOT_FOUND,
        error: `No project were found for PDB id ${pdbId}`
      };
      // Return a list with accessions from all the available projects including the PDB id
      const projectsProjection = { 'accession': true, '_id': false };
      const cursor = await database.projects.find(projectsQuery, projectsProjection);
      // Consume the cursor
      const projects = await cursor.toArray();
      return [ KNOWLEDGE_REFERENCE_KEYWORD, ...projects.map(project => project.accession) ];
    }
  }),
);

// A Project is passed -> display supported analyses available in this project
router.route('/:pdbid/:project').get(
  handler({
    async retriever(request) {
      // Set the requested PDB id
      const pdbId = request.params.pdbid;
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // If the requested project is the reference keyword then set the analyses available for this specific reference data
      // This was specifically tailored to get a reference SASA value
      if (request.params.project === KNOWLEDGE_REFERENCE_KEYWORD) {
        // Get the reference data
        const referenceData = await database.getReferenceData('pdbs', pdbId);
        if (referenceData.error) return referenceData;
        // Set the available analyses depending on the available fields
        const availableAnalyses = [];
        if (referenceData.chain_sas) availableAnalyses.push('sasa');
        // If no analysis is available then return an error
        if (availableAnalyses.length === 0) return {
          headerError: NOT_FOUND,
          error: 'No supported analyses available'
        };
        // Finally return the list with every available analysis
        return availableAnalyses;
      }
      // Get the requested project data
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Just to make it coherent, make sure the project has the PDB id in the request
      if (!project.data.metadata.PDBIDS.includes(pdbId)) return {
        headerError: NOT_FOUND,
        error: `Project ${project.accession} has no PDB ${pdbId}`
      };
      // Check which analyses are available in the project
      const projectAvailableAnalyses = project.data.analyses;
      // Find the intersection with those analyses we support in the knowledge endpoint
      const availableAnalyses = projectAvailableAnalyses.filter(analysis => SUPPORTED_ANALYSES.has(analysis));
      if (availableAnalyses.length === 0) return {
        headerError: NOT_FOUND,
        error: 'No supported analyses available'
      };
      return availableAnalyses;
    }
  }),
);

// An analysis is passed -> route to the corresponding analysis endpoint
// Now depending on the request host:
// Redirect to children routes if this is a local request
// Redirect to other APIs if this is a global request
router.use('/:pdbid/:project/:analysis', (request, response, next) => {
  // Find out if the request host is configured as global
  const config = getConfig(request);
  const isGlobal = config && config.global;
  // Also check if the project ID is indeed the reference keyword
  // If the reference is requested then this can be handled by the global API itself
  const isReference = request.params.project === KNOWLEDGE_REFERENCE_KEYWORD
  // If it is the global server and an actual project is requested then redirect accordingly
  if (isGlobal && !isReference) return redirectHandler(request, response, next);
  // Otherwise, rout forward to the local analysis
  const analysisName = request.params.analysis;
  const localHandler = require(`./${analysisName}`);
  return localHandler(request, response, next)
});

// If we are using the global API then any further query is mapped to the corresponding database
// Set a handler to be used for both GET and POST methods
const redirectHandler = handler({
  async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Get the project
    const projectData = await database.getProjectData();
    if (projectData.error) return projectData;
    // Set the local id to ask
    let localAccession = projectData.local;
    // Get the requested MD and add it to the local accession, if any
    const requestedMdIndex = database.requestedMdIndex;
    if (requestedMdIndex !== null) localAccession += `.${requestedMdIndex + 1}`;
    // Find the database thes project belongs to
    const nodeAlias = projectData.node;
    // Get the corresponding node
    const node = await database.nodes.findOne({ alias: nodeAlias });
    if (!node) return {
      headerError: INTERNAL_SERVER_ERROR,
      error: `Node "${nodeAlias}" not found`
    };
    // Get url path removing the first slash
    const urlPath = request.originalUrl.substring(1);
    // Replace the global id by the local id
    const splittedPath = urlPath.split('/');
    splittedPath[4] = localAccession;
    const replacedPath = splittedPath.join('/');
    // Build the new forwarded URL using the corresponding node API url
    const forwardedRef = node.api_url + replacedPath;
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

module.exports = router;