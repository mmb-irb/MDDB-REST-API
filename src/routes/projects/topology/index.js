const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');

const router = Router({ mergeParams: true });

// This endpoint returns a project topology
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Get the topology data
      const topologyData = await project.getTopologyData();
      // If there was any problem then stop here
      if (topologyData.error) return topologyData;
      return topologyData;
    }
  }),
);

module.exports = router;