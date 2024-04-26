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
      // If project contains no chains then report it
      if (!projectData.chains) return {
        headerError: NOT_FOUND,
        error: `Project "${projectData.accession}" has no chains`
      };
      // Return analysis names only
      return projectData.chains;
    },
  }),
);

// When there is a chain parameter (e.g. .../chains/A)
router.route('/:chain').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const projectData = await database.getProjectData();
      // If there was any problem then return the errors
      if (projectData.error) return projectData;
      // Find the chain with the provided name and project id
      const chain = await database.chains.findOne(
        // Set the query
        { project: projectData.internalId, name: request.params.chain },
        // But do not return the _id and project attributes
        { projection: { _id: false, project: false } },
      );
      return chain;
    },
  }),
);

module.exports = router;