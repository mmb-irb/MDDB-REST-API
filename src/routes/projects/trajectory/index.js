const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket } = require('mongodb');
const { Readable, PassThrough } = require('stream');

const handler = require('../../../utils/generic-handler');
// Converts the stored file (.bin) into human friendly format (chemical/mdcrd)
const BinToMdcrdStream = require('../../../utils/bin-to-mdcrd');
// Get tools to handle range queries
const handleRanges = require('../../../utils/handle-ranges');
const { rangeIndices } = require('../../../utils/parse-query-range');
// Returns a simple stream when asking for the whole file
// Returns an internally managed stream when asking for specific ranges
const getRangedStream = require('../../../utils/get-ranged-stream');
// Functions to retrieve project data and get a given file id
const { getProjectData } = require('../../../utils/get-project-data');
// Returns the selected atom indices as a string ("i1-i1,i2-i2,i3-i3..."")
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
// Translates the frames query string format into a explicit frame selection in string format
const consumeStream = require('../../../utils/consume-stream');
const chemfilesConverter = require('../../../utils/bin-to-chemfiles');
// Get the configuration parameters for the different requesting hosts
const hostConfig = require('../../../../config.js').hosts;
// Get the standard name of both structure and trajectory files
const {
  STANDARD_STRUCTURE_FILENAME,
  STANDARD_TRAJECTORY_FILENAME
} = require('../../../utils/constants');

// Standard HTTP response status codes
const {
  BAD_REQUEST,
  INTERNAL_SERVER_ERROR,
} = require('../../../utils/status-codes');

// Trajectory exporting supported formats
const trajectoryFormats = {
  bin: {
    name: 'bin',
    contentType: 'application/octet-stream',
  },
  mdcrd: {
    name: 'mdcrd',
    contentType: 'text/mdcrd',
  },
  xtc: {
    name: 'xtc',
    contentType: 'application/xtc',
    chemfilesName: 'XTC',
  },
  trr: {
    name: 'trr',
    contentType: 'application/trr',
    chemfilesName: 'TRR',
  },
  // DANI: Este formato no funciona en streaming
  // DANI: No hay ninguna ley que impida que funcione
  // DANI: Es solo que el método de escritura con el que está implementado en chemfiles no es compatible con el streaming
  // DANI: Alguien con experiencia en c++ (o con tiempo) podría arreglarlo
  // DANI: Mas detalles del problema en los mails con Guillaume
  // nc: {
  //   name: 'nc',
  //   contentType: 'application/nc',
  //   chemfilesName: 'Amber NetCDF'
  // },
};

// Check if the requested files meet the accepted formats, which are provided by the request header
// If so, send the format name. Else, send null
const acceptTransformFormat = requestedFormat => {
  // If no format is specified then the source format is returned
  if (!requestedFormat) return trajectoryFormats.bin;
  const _requestedFormat = requestedFormat.toLowerCase();
  // _requested is a string sent by the header which includes the names of all accepted formats
  if (_requestedFormat === 'crd' || _requestedFormat === 'mdcrd') {
    return trajectoryFormats.mdcrd;
  }
  if (_requestedFormat === 'xtc') {
    return trajectoryFormats.xtc;
  }
  if (_requestedFormat === 'trr') {
    return trajectoryFormats.trr;
  }
  if (_requestedFormat === 'nc') {
    return trajectoryFormats.nc;
  }
  // If format is not recognized the an error will be sent
  return null;
};

const trajectoryRouter = Router({ mergeParams: true });

// The reference to the mongo data base here is passed through the properties (db)
// The connection to the data base is made and comes from the projects index.js script
module.exports = (db, { projects, files }) => {
  // When trajectory is requested (i.e. .../trajectory)
  // Note that trajectory may be requested both trough GET and POST methods
  // POST method was implemented to allow long atom/frame selections
  const trajectoryHandler = handler({
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
        'filename': STANDARD_TRAJECTORY_FILENAME,
        'metadata.project': projectData.internalId,
        'metadata.md': { $in: [projectData.mdIndex, null] }
      }
      // Download the corresponding file
      const descriptor = await files.findOne(fileQuery);
      // If the object ID is not found in the data base, return here
      if (!descriptor) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'The trajectory file was not found in the files collections'
      };
      // Adapt the descriptor to the dimensions format
      const fileMetadata = descriptor.metadata;
      fileMetadata.x = { name: 'coords', length: 3 };
      fileMetadata.y = { name: 'atoms', length: fileMetadata.atoms };
      fileMetadata.z = { name: 'frames', length: fileMetadata.frames };
      fileMetadata.bitsize = 32;
      // Set the format in which data will be sent
      // Format is requested through the query
      const transformFormat = acceptTransformFormat(request.query.format);
      if (!transformFormat) return {
        headerError: BAD_REQUEST,
        error: 'ERROR: Not supported format. Choose one of these: ' +
          Object.keys(trajectoryFormats).join(', ')
      };

      // In case we have a selection we must parse it to atoms
      let rangedAtoms;
      const selectionRequest = request.body.selection || request.query.selection;
      if (selectionRequest) {
        // Make sure atoms were not requested as well
        const atomsRequest = request.body.atoms || request.query.atoms;
        if (atomsRequest) return {
          headerError: BAD_REQUEST,
          error: 'Cannot request "selection" and "atoms" at the same time'
        };
        // Set the file query
        // Note that we target files with the current MD index (MD files) or null MD index (project files)
        const structureFileQuery = {
          'filename': STANDARD_STRUCTURE_FILENAME,
          'metadata.project': projectData.internalId,
          'metadata.md': { $in: [projectData.mdIndex, null] }
        }
        // Download the corresponding file
        const structureDescriptor = await files.findOne(structureFileQuery);
        // If the object ID is not found in the data base, return here
        if (!structureDescriptor) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'The structure file was not found in the files collections'
        };
        // Open a stream and save it completely into memory
        const pdbFile = await consumeStream(
          bucket.openDownloadStream(structureDescriptor._id),
        );
        // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
        const atomIndices = await getAtomIndices(pdbFile, selectionRequest);
        // If no atoms where found, then return here and set the header to NOT_FOUND
        if (!atomIndices) return {
          headerError: BAD_REQUEST,
          error: 'Atoms selection is empty or wrong'
        };
        // Get arnged atom indices
        rangedAtoms = rangeIndices(atomIndices);
      }
      // When there is a selection or frame query (e.g. .../files/trajectory?selection=x)
      const parsedRanges = rangedAtoms ? { y: rangedAtoms } : {}
      const range = handleRanges(request, parsedRanges, descriptor);
      // If something is wrong with ranges then return the error
      if (range.error) return range;
      // Get the number of atoms and frames
      const atomCount = range.y.size;
      const frameCount = range.z.size;
      // Set the final stream to be returned
      let stream;
      // Return a simple stream when asking for the whole file (i.e. range is not iterable)
      // Return an internally managed stream when asking for specific ranges
      const rangedStream = getRangedStream(bucket, descriptor._id, range);
      // Get the output format name
      const transformFormatName = transformFormat.name;
      // When user requests "crd" or "mdcrd" files
      if (transformFormatName === 'mdcrd') {
        // Set a title for the mdcrd file (i.e. the first line)
        const host = request.get('host');
        const config = hostConfig[host];
        let title = config.name + ' - ' + request.params.project;
        title += '\n';
        // Add an extra chunk with the title
        // WARNING: This is important for the correct parsing of this format
        // e.g. VMD skips the first line when reading this format
        const titleStream = Readable.from([title]);
        // Start a process to convert the original .bin file to .mdcrd format
        // Atom count is required to add the breakline between frames at the mdcrd format
        const transformStream = BinToMdcrdStream(atomCount);
        const lengthConverter = BinToMdcrdStream.CONVERTER;
        // Calculate the bytes length in the new format
        // WARNING: The size of the title must be included in the range (and then content-length)
        range.size = lengthConverter(range.size, atomCount) + Buffer.byteLength(title);
        // Set a new stream which is ready to be destroyed
        // It is destroyed when the .bin to .mdcrd process or the client request are over
        rangedStream.pipe(transformStream);
        transformStream.on('close', () => rangedStream.destroy());
        request.on('close', () => rangedStream.destroy());
        // Combine both the title and the main data streams
        let combined = new PassThrough();
        combined = titleStream.pipe(combined, { end: false });
        combined = transformStream.pipe(combined, { end: false });
        // WARNING: Do not use outputStream.emit('end') here!!
        // This could trigger the 'end' event before all data has been consumed by the next stream
        transformStream.once('end', () => combined.end());
        // Return the .bin to .mdcrd process stream
        stream = combined;
      } else if (
        transformFormatName === 'xtc' ||
        transformFormatName === 'trr' ||
        transformFormatName === 'nc'
      ) {
        // Use chemfiles to convert the trajectory from .bin to the requested format
        stream = chemfilesConverter(
          rangedStream,
          atomCount,
          frameCount,
          transformFormat.chemfilesName,
        );
        // We can not predict the size of the resulting file (yet?)
        range.size = null;
      } else if (transformFormatName === 'bin') {
        stream = rangedStream;
      } else {
        throw new Error('Missing instructions to export format');
      }
      // Get the accession, if exists, or get the id
      const accessionOrId = projectData.accession
        ? projectData.accession.toLowerCase()
        : projectData.identifier;
      return {
        stream,
        descriptor,
        range,
        transformFormat,
        accessionOrId,
      };
    },
    // Handle the response header
    headers(
      response,
      {
        stream,
        descriptor,
        range,
        transformFormat,
        accessionOrId,
        headerError,
      },
    ) {
      // In case of error
      if (headerError) return response.status(headerError);
      // Something went wrong here
      if (!stream) return response.sendStatus(INTERNAL_SERVER_ERROR);
      
      // NEVER FORGET: 'content-range' were disabled and now this data is got from project files
      // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
      //response.set('content-range', range.responseHeaders);

      // NEVER FORGET: This partial content (i.e. 206) makes Chrome fail when downloading data directly from API
      //response.status(PARTIAL_CONTENT);

      // Send the expected bytes length of the file
      // WARNING: If sent bytes are less than specified the download will fail with error signal
      // WARNING: If sent bytes are more than specified the download will succed but it will be cutted
      // WARNING: If sent bytes are a decimal number or null then it will generate an error 502 (Bad Gateway)
      // If we dont send this header the download works anyway, but the user does not know how long it is going to take
      if (range.size) {
        if (range.size % 1 !== 0) console.error('ERROR: Size is not integer');
        response.set('content-length', range.size);
      }
      if (descriptor.contentType) {
        response.set(
          'content-type',
          // Here descriptor.contentType should be "application/octet-stream"
          transformFormat.contentType,
        );
      }
      // Set the output filename according to some standards
      const filename = accessionOrId + '_trajectory.' + transformFormat.name;
      response.setHeader(
        'Content-disposition',
        `attachment; filename=${filename}`,
      );

      response.set('accept-ranges', ['bytes', 'atoms', 'frames']);
    },
    body(response, { stream, error }, request) {
      // In case of error
      if (error) return response.json(error);
      // Something went very wrong here
      if (!stream) return response.end();

      if (request.aborted) {
        stream.destroy();
        return;
      }

      // WARNING: Do not substitute the supervised "response.write" by a "stream.pipe(response)"
      // "pipe" is not able to detect overloading in the response (Unknown reason)
      // Therefore, if response is piped, there may be a memory leak in some situations
      // For example, when client stops receiving data but connection is not closed
      // (e.g. When you pause but do not cancell the download from Chrome)

      // Write the input readable stream with the trajectroy data into the response
      // This is possible since the response is a writable stream itself
      stream.on('data', data => {
        // If you are having this error it means some 'end' event is beeing triggered before all data is consumed
        if (response.finished)
          return console.error('ERROR: Potential data loss');
        stream.pause();
        // Check that local buffer is sending data out before continue to prevent memory leaks
        response.write(data, () => {
          stream.resume();
        });
        // use these lines to prevent system collapse in case of memory leak
        /*
        if(process.memoryUsage().rss > 300000000){
          console.error("Memory leak detected");
          stream.destroy();
          console.error("Current stream has been destroyed");
          return;
        }
        */
      });
      // In case of error, print error in console
      stream.on('error', error => {
        console.error(error);
        response.end();
      });
      // Close the response when the read stream has finished
      stream.on('end', data => response.end(data));
      // Close the stream when request is over
      request.on('close', () => stream.destroy());
    },
  });

  // Support both the http GET and POST methods
  trajectoryRouter.route('/').get(trajectoryHandler);
  trajectoryRouter.route('/').post(trajectoryHandler);

  return trajectoryRouter;
};
