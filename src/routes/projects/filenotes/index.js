const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');
// Get an automatic mongo query parser based on environment and request
const { isObjectId } = require('../../../utils/get-project-query');

// Functions to retrieve project data and get a given file id
const { getProjectData } = require('../../../utils/get-project-data');

// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR, BAD_REQUEST } = require('../../../utils/status-codes');

// Set a function to clean file descriptors by renaming the field '_id' as 'identifier'
const cleanFileDescriptor = descriptor => {
  descriptor.identifier = descriptor._id;
  delete descriptor._id;
  return descriptor;
}

const filenotesRouter = Router({ mergeParams: true });

// The reference to the mongo data base here is passed through the properties (db)
// The connection to the data base is made and comes from the projects index.js script
module.exports = (db, { projects, files }) => {
  // Root
  filenotesRouter.route('/').get(
    handler({
      async retriever(request) {
        // Get the requested project data
        const projectData = await getProjectData(projects, request);
        // If there was any problem then return the errors
        if (projectData.error) return projectData;
        // If project data does not contain the 'mds' field then it may mean it is in the old format
        if (!projectData.mds) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'Project is missing mds. Is it in an old format?'
        };
        // Send all file descriptions
        const filesQuery = {
          'metadata.project': projectData.identifier,
          'metadata.md': { $in: [projectData.mdIndex, null] },
        };
        const filesCursor = await files.find(filesQuery, { _id: false });
        const filesData = await filesCursor.toArray();
        return filesData.map(descriptor => cleanFileDescriptor(descriptor));
      },
      // Handle the response header
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
      },
    }),
  );

  // When there is a file parameter
  // e.g. .../filenotes/structure.pdb
  filenotesRouter.route('/:file').get(
    handler({
      async retriever(request) {
        // If the query is an object id itself we refuse it
        // This was before supported but never used
        if (isObjectId(request.params.file)) return {
          headerError: BAD_REQUEST,
          error: 'Requesting a file by its internal ID is no longer supported'
        };
        // Find the requested project data
        const projectData = await getProjectData(projects, request);
        // If there was any problem then return the errors
        if (projectData.error) return projectData;
        // Set the file query
        // Note that we target files with the current MD index (MD files) or null MD index (project files)
        const fileQuery = {
          'filename': request.params.file,
          'metadata.project': projectData.identifier,
          'metadata.md': { $in: [projectData.mdIndex, null] }
        }
        // Download the corresponding file
        const descriptor = await files.findOne(fileQuery);
        // If the object ID is not found in the data base the we have a mess
        // This is our fault, since a file id coming from a project must exist
        if (!descriptor) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'File was not found in the files collection'
        };
        return cleanFileDescriptor(descriptor);
      },
      // Handle the response header
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) return response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Return the descriptor
        return response.json(retrieved);
      },
    }),
  );

  return filenotesRouter;
};
