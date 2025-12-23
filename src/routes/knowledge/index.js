const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Standard HTTP response status codes
const { NOT_FOUND } = require('../../utils/status-codes');

const router = Router({ mergeParams: true });

// List the supported analyses with knowledge endpoint
const SUPPORTED_ANALYSES = new Set(['sasa']);

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
      return projects.map(project => project.accession);
    }
  }),
);

// A Project is passed -> display supported analyses available in this project
router.route('/:pdbid/:project').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Just to make it coherent, make sure the project has the PDB id in the request
      const pdbId = request.params.pdbid;
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
router.use('/:pdbid/:project/sasa', require('./sasa'));

module.exports = router;