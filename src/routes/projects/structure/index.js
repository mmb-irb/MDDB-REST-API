const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket } = require('mongodb');
const { Readable } = require('stream');

const handler = require('../../../utils/generic-handler');
// Returns a pdb filtered according to an NGL selection
const getSelectedPdb = require('../../../utils/get-selection-pdb-through-ngl');
const consumeStream = require('../../../utils/consume-stream');
// Functions to retrieve project data and get a given file id
const { getProjectData } = require('../../../utils/get-project-data');

// Standard HTTP response status codes
const {
  NOT_FOUND,
  INTERNAL_SERVER_ERROR,
} = require('../../../utils/status-codes');

// Get the standard name of the structure file
const { STANDARD_STRUCTURE_FILENAME } = require('../../../utils/constants');
// Get a function to issue a standard output filename
const { setOutpuFilename } = require('../../../utils/auxiliar-functions');

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
      const projectData = await getProjectData(projects, request);
      // If there was any problem then return the errors
      if (projectData.error) return projectData;
      // Set the file query
      // Note that we target files with the current MD index (MD files) or null MD index (project files)
      const fileQuery = {
        'filename': STANDARD_STRUCTURE_FILENAME,
        'metadata.project': projectData.internalId,
        'metadata.md': { $in: [projectData.mdIndex, null] }
      }
      // Download the corresponding file
      const descriptor = await files.findOne(fileQuery);
      // If the object ID is not found in the data base the we have a mess
      // This is our fault, since a file id coming from a project must exist
      if (!descriptor) return {
        headerError: NOT_FOUND,
        error: 'The structure file was not found in the files collection'
      };
      // Get the file id
      const fileId = descriptor._id;
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
        : projectData.identifier;
      // Set the output filename according to some standards
      const filename = setOutpuFilename(projectData, descriptor);
      return { filename, descriptor, stream, accessionOrId };
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
      // Set the output filename
      response.setHeader(
        'Content-disposition',
        `attachment; filename=${retrieved.filename}`,
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
