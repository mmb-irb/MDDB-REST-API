const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');

const router = Router({ mergeParams: true });

// Root
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Return analysis names only
      return project.data.analyses;
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
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Query the database and retrieve the requested analysis
      const analysisName = request.params.analysis.toLowerCase();
      return await project.getAnalysisData(analysisName);
    }
  }),
);

module.exports = router;