const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Get an automatic mongo query parser based on environment and request
const { isObjectId } = require('../../../utils/get-project-query');

// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR, BAD_REQUEST, NOT_FOUND } = require('../../../utils/status-codes');

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
      const projectData = await database.getProjectData();
      // If there was any problem then return the errors
      if (projectData.error) return projectData;
      // If project data does not contain the 'mds' field then it may mean it is in the old format
      if (!projectData.mds) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'Project is missing mds. Is it in an old format?'
      };
      // Send all file descriptions
      const filesQuery = {
        'metadata.project': projectData.internalId,
        'metadata.md': { $in: [projectData.mdIndex, null] },
      };
      const filesCursor = await database.files.find(filesQuery, { _id: false });
      const filesData = await filesCursor.toArray();
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
      const projectData = await database.getProjectData();
      // If there was any problem then return the errors
      if (projectData.error) return projectData;
      // Set the file query
      // Note that we target files with the current MD index (MD files) or null MD index (project files)
      const fileQuery = {
        'filename': request.params.file,
        'metadata.project': projectData.internalId,
        'metadata.md': { $in: [projectData.mdIndex, null] }
      }
      // Download the corresponding file
      const descriptor = await database.files.findOne(fileQuery);
      // If the object ID is not found in the data base the we have a mess
      // This is our fault, since a file id coming from a project must exist
      if (!descriptor) return {
        headerError: NOT_FOUND,
        error: 'File was not found in the files collection'
      };
      return cleanFileDescriptor(descriptor);
    }
  }),
);

module.exports = router;