const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket } = require('mongodb');
const { Readable } = require('stream');

const handler = require('../../../utils/generic-handler');
// Returns a pdb filtered according to an NGL selection
const getSelectedPdb = require('../../../utils/get-selection-pdb-through-ngl');
const consumeStream = require('../../../utils/consume-stream');
// Functions to retrieve project data and get a given file id
const { getProjectData, getFileId } = require('../../../utils/get-project-data');

// Standard HTTP response status codes
const {
  NOT_FOUND,
  INTERNAL_SERVER_ERROR,
} = require('../../../utils/status-codes');

// Set the standard name of the structure file
const STANDARD_STRUCTURE_FILENAME = 'md.imaged.rot.dry.pdb';

const structureRouter = Router({ mergeParams: true });

// The reference to the mongo data base here is passed through the properties (db)
// The connection to the data base is made and comes from the projects index.js script
module.exports = (db, { projects, files }) => {
  // When structure is requested (i.e. .../structure)
  // Note that structure may be requested both through GET and POST methods
  // POST method was implemented to allow long atom selections
  const structureHandler = handler({
    async retriever(request) {
      // Set the bucket, which allows downloading big files from the database
      const bucket = new GridFSBucket(db);
      // Find the requested project data
      const projectDataRequest = await getProjectData(projects, request);
      // If there was any problem then return the errors
      if (projectDataRequest.error) return projectDataRequest;
      // Get the actual project data
      const { projectData, requestedMdIndex } = projectDataRequest;
      // Now find the structure file id in the project data
      const fileIdRequest = getFileId(projectData, requestedMdIndex, STANDARD_STRUCTURE_FILENAME);
      // If there was any problem then return the errors
      if (fileIdRequest.error) return fileIdRequest;
      // Get the actual structure file id
      const { fileId } = fileIdRequest;
      // Save the corresponding file, which is found by object id
      const descriptor = await files.findOne({ _id: fileId });
      // If the object ID is not found in the data base the we have a mess
      // This is our fault, since a file id coming from a project must exist
      if (!descriptor) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'The structure file was not found in the files collection'
      };
      // Open a stream with the corresponding ID
      let stream = bucket.openDownloadStream(fileId);
      const selection = request.body.selection || request.query.selection;
      // In case of selection query
      if (selection) {
        // Open a stream and save it completely into memory
        const pdbFile = await consumeStream(bucket.openDownloadStream(fileId));
        // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
        const selectedPdb = await getSelectedPdb(pdbFile, selection);
        // Selected pdb will be never null, since an empty pdb file would have header and end
        // Now convert the string pdb to a stream
        //const bufferPdb = Buffer.from(selectedPdb, 'base64');
        const bufferPdb = Buffer.from(selectedPdb, 'utf-8');
        stream = Readable.from([bufferPdb]);
        // Modify the original length
        descriptor.length = bufferPdb.length;
      } else {
        stream = bucket.openDownloadStream(fileId);
      }
      // Get the accession, if exists, or get the id
      const accessionOrId = projectData.accession
        ? projectData.accession.toLowerCase()
        : projectData._id;
      return { descriptor, stream, accessionOrId };
    },
    // Handle the response header
    headers(response, retrieved) {
      // There should always be a retrieved object
      if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
      // If there is any specific header error in the retrieved then send it
      // Note that we do not end the response here since the body may contain additional error details
      if (retrieved.headerError) return response.status(retrieved.headerError);
      // If there is no descriptor then send a NOT FOUND signal as well
      if (!retrieved.descriptor) return response.sendStatus(NOT_FOUND);
      // If there is an active stream, send range and length content
      response.set('content-length', retrieved.descriptor.length);
      // Send content type also if known
      if (retrieved.descriptor.contentType) {
        response.set('content-type', retrieved.descriptor.contentType);
      }
      // Set the output filename according to some standards
      const format = 'pdb';
      const filename = retrieved.accessionOrId + '_structure.' + format;
      response.setHeader(
        'Content-disposition',
        `attachment; filename=${filename}`,
      );
    },
    // Handle the response body
    body(response, retrieved, request) {
      // If nothing is retrieved then end the response
      // Note that the header 'sendStatus' function should end the response already, but just in case
      if (!retrieved) return response.end();
      // If there is any error in the body then just send the error
      if (retrieved.error) return response.json(retrieved.error);
      // If there is not retreieved stream, return here
      if (!retrieved.stream) return response.end();
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
  });

  // Support both the http GET and POST methods
  structureRouter.route('/').get(structureHandler);
  structureRouter.route('/').post(structureHandler);

  return structureRouter;
};
