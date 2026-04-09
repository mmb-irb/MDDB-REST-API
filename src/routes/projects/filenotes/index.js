const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Get an automatic mongo query parser based on environment and request
const { isObjectId } = require('../../../utils/auxiliar-functions');

// Standard HTTP response status codes
const { BAD_REQUEST } = require('../../../utils/status-codes');

// Set a function to clean file descriptors by renaming the field '_id' as 'internalId'
const cleanFileDescriptor = descriptor => {
  descriptor.internalId = descriptor._id;
  delete descriptor._id;
  return descriptor;
}

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
      // Get all file descriptions
      const filesData = await project.getFileDescriptors();
      return filesData.map(descriptor => cleanFileDescriptor(descriptor));
    }
  }),
);

// When there is a file parameter
// e.g. .../filenotes/structure.pdb
router.route('/:file').get(
  handler({
    async retriever(request) {
      // If the query is an object id itself we refuse it
      // This was before supported but never used
      if (isObjectId(request.params.file)) return {
        headerError: BAD_REQUEST,
        error: 'Requesting a file by its internal ID is no longer supported'
      };
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Find the requested project data
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Download the corresponding file descritpor
      const descriptor = await project.getFileDescriptor(request.params.file);
      // If the object ID is not found in the data base the we have a mess
      // This is our fault, since a file id coming from a project must exist
      if (descriptor.error) return descriptor;
      return cleanFileDescriptor(descriptor);
    }
  }),
);

module.exports = router;