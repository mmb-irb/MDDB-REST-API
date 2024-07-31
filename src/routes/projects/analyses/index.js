const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND } = require('../../../utils/status-codes');

const router = Router({ mergeParams: true });

// Root
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const projectData = await database.getProjectData();
      // If there was any problem then return the errors
      if (projectData.error) return projectData;
      // Return analysis names only
      return projectData.analyses;
    }
  }),
);

// When a specific analysis is requested (e.g. .../analyses/rmsds)
router.route('/:analysis').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const projectData = await database.getProjectData();
      // If there was any problem then return the errors
      if (projectData.error) return projectData;
      // Query the database and retrieve the requested analysis
      const analysisData = await database.analyses.findOne(
        // Set the query
        {
          project: projectData.internalId,
          md: projectData.mdIndex,
          name: request.params.analysis.toLowerCase(),
        },
        // Skip some useless values
        { projection: { _id: false, name: false, project: false, md: false } },
      );
      // If we did not found the analysis then return a not found error
      if (!analysisData) return {
        headerError: NOT_FOUND,
        error: `Analysis "${request.params.analysis}" not found. Project ${
          projectData.accession
        } has the following available analyses: ${
          // Get the list of available analyses for this project to provide more help
          projectData.analyses.join(', ')
        }`
      };
      // Send the analysis data
      return analysisData.value;
    }
  }),
);

module.exports = router;