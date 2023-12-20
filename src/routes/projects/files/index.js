const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket } = require('mongodb');

const handler = require('../../../utils/generic-handler');
// Get an automatic mongo query parser based on environment and request
const { isObjectId } = require('../../../utils/get-project-query');

// Functions to retrieve project data and get a given file id
const { getProjectData, getFileId } = require('../../../utils/get-project-data');

// Standard HTTP response status codes
const {
  BAD_REQUEST,
  NOT_FOUND,
  INTERNAL_SERVER_ERROR,
} = require('../../../utils/status-codes');

// Set a function to find out if descriptors were requested
const isDescriptorRequested = request => {
  // If the argument was not even passed then descriptor is not requested
  if (!('descriptor' in request.query)) return false;
  // If the argument was explicitly set to false then descriptor is not requested
  if (request.query.descriptor === 'false') return false;
  // Otherwise, if the argument was passed with any value (even empty) the descriptor is requested
  return true;
};

const fileRouter = Router({ mergeParams: true });

// The reference to the mongo data base here is passed through the properties (db)
// The connection to the data base is made and comes from the projects index.js script
module.exports = (db, { projects, files }) => {
  // Root
  fileRouter.route('/').get(
    handler({
      async retriever(request) {
        // Find the requested project data
        const projectDataRequest = await getProjectData(projects, request);
        // If there was any problem then return the errors
        if (projectDataRequest.error) return projectDataRequest;
        // Get the actual project data
        const { projectData, requestedMdIndex } = projectDataRequest;
        // Check if the request is only for the descriptor
        const descriptorRequested = isDescriptorRequested(request);
        // If project data does not contain the 'mds' field then it means it is in the old format
        if (!projectData.mds) {
          // Make sure no md was requested or raise an error to avoid silent problems
          // User may think each md returns different data otherwise
          if (requestedMdIndex !== null) return {
            headerError: BAD_REQUEST,
            error: 'This project has no MDs. Please use the accession or id alone.'
          };
          // If the description was requested then send all file descriptions
          if (descriptorRequested) {
            const filesQuery = { 'metadata.project': projectData._id };
            const filesCursor = await files.find(filesQuery, { _id: false });
            const filesData = await filesCursor.toArray();
            return filesData;
          } else return projectData.files.map(file => file.filename);
        }
        // Get the MD index, which is the requested index or, if none, the reference index
        const mdIndex = requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
        // If the description was requested then send all file descriptions
        if (descriptorRequested) {
          const filesQuery = {
            'metadata.project': projectData._id,
            'metadata.md': mdIndex,
          };
          const filesCursor = await files.find(filesQuery, { _id: false });
          const filesData = await filesCursor.toArray();
          return filesData;
        }
        // Get the corresponding MD data
        const mdData = projectData.mds[mdIndex];
        // If the corresponding index does not exist then return an error
        if (!mdData) return {
          headerError: NOT_FOUND,
          error: 'The requested MD does not exists. Try with numbers 1-' + projectData.mds.length
        };
        // Return just a list with the filenames
        return mdData.files.map(file => file.name);
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

  // Both structure and trajectory endpoints were here before so this route is conserved
  fileRouter.use('/structure', require('../structure')(db, { projects, files }));
  fileRouter.use('/trajectory', require('../trajectory')(db, { projects, files }));

  // When there is a file parameter
  // e.g. .../files/structure.pdb
  // e.g. .../files/5d08c0d8174bf85a17e00861
  fileRouter.route('/:file').get(
    handler({
      async retriever(request) {
        // Set the bucket, which allows downloading big files from the database
        const bucket = new GridFSBucket(db);
        // Find the object id of the file to be downloaded
        let fileId;
        // If the query is an object id itself then just parse it
        if (isObjectId(request.params.file)) {
          fileId = request.params.file;
        }
        // If the query is a filename then find the corresponding object id
        else {
          // Find the requested project data
          const projectDataRequest = await getProjectData(projects, request);
          // If there was any problem then return the errors
          if (projectDataRequest.error) return projectDataRequest;
          // Get the actual project data
          const { projectData, requestedMdIndex } = projectDataRequest;
          // Now find the structure file id in the project data
          const fileIdRequest = getFileId(projectData, requestedMdIndex, request.params.file);
          // If there was any problem then return the errors
          if (fileIdRequest.error) return fileIdRequest;
          // Get the actual structure file id
          fileId = fileIdRequest.fileId;
        }
        // Save the corresponding file
        const descriptor = await files.findOne({ _id: fileId });
        // If the object ID is not found in the data base the we have a mess
        // This is our fault, since a file id coming from a project must exist
        if (!descriptor) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'File was not found in the files collection'
        };
        // Check if the request is only for the descriptor
        const descriptorRequested = isDescriptorRequested(request);
        if (descriptorRequested) return { descriptor, stream: null, descriptorRequested };
        // Open a stream with the corresponding id only if the descriptor flag was not passed
        const stream = bucket.openDownloadStream(fileId);
        // If we fail to stablish the stream then send an error
        if (!stream) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'Failed to set the bucket stream'
        };
        return { descriptor, stream, descriptorRequested };
      },
      // Handle the response header
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) return response.status(retrieved.headerError);
        // If the request is only for the descriptor then there is nothing to do in the header
        if (retrieved.descriptorRequested) return;
        // If there is an active stream, send range and length content
        const contentRanges = [`bytes=*/${retrieved.descriptor.length}`];
        if (retrieved.descriptor.metadata.frames) {
          contentRanges.push(`frames=*/${retrieved.descriptor.metadata.frames}`);
        }
        if (retrieved.descriptor.metadata.atoms) {
          contentRanges.push(`atoms=*/${retrieved.descriptor.metadata.atoms}`);
        }
        // NEVER FORGET: 'content-range' where disabled and now this data is got from project files
        // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
        //response.set('content-range', contentRanges);
        response.set('content-length', retrieved.descriptor.length);
        // Send content type also if known
        if (retrieved.descriptor.contentType) {
          response.set('content-type', retrieved.descriptor.contentType);
        }
        // Set the output filename
        response.setHeader(
          'Content-disposition',
          `attachment; filename=${retrieved.descriptor.filename}`,
        );
      },
      // Handle the response body
      body(response, retrieved, request) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // If the request is only for the descriptor then there is nothing to do in the header
        if (retrieved.descriptorRequested)
          return response.json(retrieved.descriptor);
        // If the client has aborted the request before the streams starts, destroy the stream
        if (request.aborted) {
          retrieved.stream.destroy();
          return;
        }
        // If there is a retrieved stream, start sending data through the stream
        retrieved.stream.on('data', data => {
          retrieved.stream.pause();
          response.write(data, () => {
            retrieved.stream.resume();
          });
        });
        // If there is an error, send the error to the console and end the data transfer
        retrieved.stream.on('error', error => {
          console.error(error);
          response.end();
        });
        // Close the response when the read stream has finished
        retrieved.stream.on('end', data => response.end(data));
        // Close the stream when the request is closed
        request.on('close', () => retrieved.stream.destroy());
      },
    }),
  );

  return fileRouter;
};
