const Router = require('express').Router;
const { Readable } = require('stream');
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
const consumeStream = require('../../../utils/consume-stream');
// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Get the standard name of the structure file
const { STANDARD_STRUCTURE_FILENAME } = require('../../../utils/constants');
// Get a function to issue a standard output filename
const { setOutputFilename } = require('../../../utils/auxiliar-functions');
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
// Function to produce a PDB from topology and coordinates
const producePdb = require('./produce-pdb');

const router = Router({ mergeParams: true });

// When structure is requested (i.e. .../structure)
// Note that structure may be requested both through GET and POST methods
// POST method was implemented to allow long atom selections
const structureHandler = handler({
  async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Set the bucket, which allows downloading big files from the database
    const bucket = database.bucket;
    // Find the requested project data
    const project = await database.getProject();
    // If there was any problem then return the errors
    if (project.error) return project;
    // Download the main structure file descriptor
    const structureDescriptor = await project.getFileDescriptor(STANDARD_STRUCTURE_FILENAME);
    // If the object ID is not found in the data base the we have a mess
    // This is our fault, since a file id coming from a project must exist
    if (structureDescriptor.error) return structureDescriptor;
    // Get the file id
    const fileId = structureDescriptor._id;
    // Open a stream with the corresponding ID
    let stream = bucket.openDownloadStream(fileId);
    // We check both the body (in case it is a POST) and the query (in case it is a GET)
    const selection = request.body.selection || request.query.selection;
    // In case of selection query we will produce a filtered PDB
    if (selection) {
      // Open a stream and save it completely into memory
      const pdbFile = await consumeStream(bucket.openDownloadStream(fileId));
      // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
      const atomIndices = await getAtomIndices(pdbFile, selection);
      // Get the topology data
      const topologyData = await project.getTopologyData();
      // Get reference frame coordinates
      const frameCoordinates = await project.getFrameCoordinates(project.referenceFrame, atomIndices);
      if (frameCoordinates.error) return frameCoordinates;
      // Produce a filtered PDB file using both the topology data and reference frame coordinates
      const pdbContent = producePdb(topologyData, frameCoordinates, atomIndices);
      // Convert the PDB content to a buffer adn then to a stream
      const bufferPdb = Buffer.from(pdbContent, 'utf-8');
      stream = Readable.from([bufferPdb]);
      // Modify the original descriptor length
      structureDescriptor.length = bufferPdb.length;
    } else {
      stream = bucket.openDownloadStream(fileId);
    }
    // Set the output filename according to some standards
    const filename = setOutputFilename(project.data, structureDescriptor);
    return { filename, structureDescriptor, stream };
  },
  // Handle the response header
  headers(response, retrieved) {
    // There should always be a retrieved object
    if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
    // If there is any specific header error in the retrieved then send it
    // Note that we do not end the response here since the body may contain additional error details
    if (retrieved.headerError) return response.status(retrieved.headerError);
    // If there is an active stream, send range and length content
    response.set('content-length', retrieved.structureDescriptor.length);
    // Send content type also if known
    if (retrieved.structureDescriptor.contentType) {
      response.set('content-type', retrieved.structureDescriptor.contentType);
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
router.route('/').get(structureHandler);
router.route('/').post(structureHandler);

module.exports = router;