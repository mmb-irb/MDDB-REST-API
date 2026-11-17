const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');

const router = Router({ mergeParams: true });

// Root
// Return everything the monitor needs to add a project to the global database in a single request:
// the raw project data and the file descriptors of essential files in all its MDs
router.route('/').get(
  handler({
    supportedArguments: [],
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the raw project data, including all MDs
      const project = await database.getRawProjectData();
      if (project.error) return project;
      // Get the file descriptors of essential files in all MDs, including project files (with null MD index)
      // These are the files the monitor checks before federating a project
      const essentialFilenames = database.ESSENTIAL_FILES.flat();
      const filesQuery = { 'metadata.project': project._id, filename: { $in: essentialFilenames } };
      const filenotes = await database.files.find(filesQuery).toArray();
      // Rename the '_id' field as 'internalId', as in the filenotes endpoint
      filenotes.forEach(descriptor => {
        descriptor.internalId = descriptor._id;
        delete descriptor._id;
      });
      // Note that the filenotes list may be empty
      return { project, filenotes };
    }
  }),
);

module.exports = router;
