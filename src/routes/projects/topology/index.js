const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND } = require('../../../utils/status-codes');

const router = Router({ mergeParams: true });

// This endpoint returns a project topology
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const projectData = await database.getProjectData();
      // If there was any problem then return the errors
      if (projectData.error) return projectData;
      // Return the project which matches the request accession
      const topology = await database.topologies.findOne(
        { project: projectData.internalId },
        { projection: { _id: false, project: false } },
      );
      // If no topology was found then return here
      if (!topology) return {
        headerError: NOT_FOUND,
        error: `Project ${projectData.accession} has no topology`
      };
      delete topology._id;
      return topology;
    }
  }),
);

module.exports = router;