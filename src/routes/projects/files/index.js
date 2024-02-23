const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket } = require('mongodb');

const handler = require('../../../utils/generic-handler');
// Get an automatic mongo query parser based on environment and request
const { isObjectId } = require('../../../utils/get-project-query');

// Functions to retrieve project data and get a given file id
const { getProjectData } = require('../../../utils/get-project-data');

// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR, BAD_REQUEST } = require('../../../utils/status-codes');

// Handle query ranges
const handleRanges = require('../../../utils/handle-ranges');
const getRangedStream = require('../../../utils/get-ranged-stream');

// Converts a binary file (.bin) into actual values
const binToValues = require('../../../utils/bin-to-values');

const fileRouter = Router({ mergeParams: true });

// The reference to the mongo data base here is passed through the properties (db)
// The connection to the data base is made and comes from the projects index.js script
module.exports = (db, { projects, files }) => {
  // Root
  fileRouter.route('/').get(
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
        return projectData.files;
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
  fileRouter.route('/:file').get(
    handler({
      async retriever(request) {
        // If the query is an object id itself we refuse it
        // This was before supported but never used
        if (isObjectId(request.params.file)) return {
          headerError: BAD_REQUEST,
          error: 'Requesting a file by its internal ID is no longer supported'
        };
        // Set the bucket, which allows downloading big files from the database
        const bucket = new GridFSBucket(db);
        // Find the requested project data
        const projectData = await getProjectData(projects, request);
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
        const descriptor = await files.findOne(fileQuery);
        // If the object ID is not found in the data base the we have a mess
        // This is our fault, since a file id coming from a project must exist
        if (!descriptor) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'File was not found in the files collection'
        };
        // Find range parameters in the request and parse them
        const range = handleRanges(request, {}, descriptor);
        // If something is wrong with ranges then return the error
        if (range.error) return range;
        // Set the output size
        // Note this size will change if we parse the output
        let byteSize = range.byteSize;
        // Return a simple stream when asking for the whole file (i.e. range is not iterable)
        // Return an internally managed stream when asking for specific ranges
        const rangedStream = getRangedStream(bucket, descriptor._id, range);
        // If we fail to stablish the stream then send an error
        if (!rangedStream) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'Failed to set the stream'
        };
        // Check if the parse flag has been passed
        const parse = request.query.parse;
        const isParse = parse !== undefined && parse !== 'false';
        // Parse the final stream if the flag is parse has been passed
        let finalStream = rangedStream;
        if (isParse) {
          // Make sure it is not a byte request
          // It is not possible to support the parsing if we do not know the actual desired values
          if (range.byteRequest) return {
            headerError: BAD_REQUEST,
            error: 'Cannot parse a byte ranged request. Ask for dimensional ranges instead.'
          };
          finalStream = binToValues(descriptor, range);
          rangedStream.pipe(finalStream);
          // Update the output size
          // DANI: Esto está hardcodeado, hay que definir el output type a parsear en el file metadata
          const OUTPUT_BYTES_PER_ELEMENT = 1;
          byteSize = range.nvalues * OUTPUT_BYTES_PER_ELEMENT;
        }
        return { descriptor, stream: finalStream, byteSize, projectData };
      },
      // Handle the response header
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) return response.status(retrieved.headerError);
        // If there is an active stream, send range and length content
        const descriptor = retrieved.descriptor;
        const contentRanges = [`bytes=*/${descriptor.length}`];
        if (descriptor.metadata.frames) {
          contentRanges.push(`frames=*/${descriptor.metadata.frames}`);
        }
        if (descriptor.metadata.atoms) {
          contentRanges.push(`atoms=*/${descriptor.metadata.atoms}`);
        }
        // NEVER FORGET: 'content-range' where disabled and now this data is got from project files
        // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
        //response.set('content-range', contentRanges);
        response.set('content-length', retrieved.byteSize);
        // Send content type also if known
        if (descriptor.contentType) {
          response.set('content-type', descriptor.contentType);
        }
        // Set the output filename by adding the id or accession as prefix
        let prefix = retrieved.projectData.accession || retrieved.projectData.identifier;
        if (descriptor.metadata.md !== null) prefix += '.' + (descriptor.metadata.md + 1);
        const filename = prefix + '_' + descriptor.filename;
        response.setHeader('Content-disposition', `attachment; filename=${filename}`);
      },
      // Handle the response body
      body(response, retrieved, request) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
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
