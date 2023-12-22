const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket } = require('mongodb');
const { Readable, PassThrough } = require('stream');

const handler = require('../../../utils/generic-handler');
// Converts the stored file (.bin) into human friendly format (chemical/mdcrd)
const BinToMdcrdStream = require('../../../utils/bin-to-mdcrd');
// Converts ranges of different types (e.g. frames or atoms) into a single summarized range of bytes
const handleRange = require('../../../utils/handle-range');
// Returns a simple stream when asking for the whole file
// Returns an internally managed stream when asking for specific ranges
const combineDownloadStreams = require('../../../utils/combine-download-streams');
// Functions to retrieve project data and get a given file id
const { getProjectData } = require('../../../utils/get-project-data');
// Returns the selected atom indices as a string ("i1-i1,i2-i2,i3-i3..."")
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
// Translates the frames query string format into a explicit frame selection in string format
const parseQuerystringFrameRange = require('../../../utils/parse-querystring-frame-range');
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
        'metadata.project': projectData.identifier,
        'metadata.md': { $in: [projectData.mdIndex, null] }
      }
      // Download the corresponding file
      const descriptor = await files.findOne(fileQuery);
      // If the object ID is not found in the data base, return here
      if (!descriptor) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'The trajectory file was not found in the files collections'
      };
      // Set the format in which data will be sent
      // Format is requested through the query
      const transformFormat = acceptTransformFormat(request.query.format);
      if (!transformFormat) return {
        headerError: BAD_REQUEST,
        error: 'ERROR: Not supported format. Choose one of these: ' +
          Object.keys(trajectoryFormats).join(', ')
      };

      // range handling
      // range in querystring > range in headers
      // but we do transform the querystring format into the headers format

      // When there is a selection or frame query (e.g. .../files/trajectory?selection=x)
      let range;
      const selection = request.body.selection || request.query.selection;
      const frames = request.body.frames || request.query.frames;
      if (selection || frames) {
        let rangeString = '';
        // In case of selection query
        if (selection) {
          // Set the file query
          // Note that we target files with the current MD index (MD files) or null MD index (project files)
          const structureFileQuery = {
            'filename': STANDARD_STRUCTURE_FILENAME,
            'metadata.project': projectData.identifier,
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
          const atoms = await getAtomIndices(pdbFile, selection);
          // If no atoms where found, then return here and set the header to NOT_FOUND
          if (!atoms) return {
            headerError: BAD_REQUEST,
            error: 'Atoms selection is empty or wrong'
          };
          // Else, save the atoms indices with the "atoms=" head
          rangeString = `atoms=${atoms}`;
        }
        // In case of frame query
        if (frames) {
          // If data is already saved in the rangeString variable because there was a selection query
          if (rangeString) rangeString += ', '; // Add coma and space to separate the new incoming data
          // Translates the frames query string format into a explicit frame selection in string format
          const parsed = parseQuerystringFrameRange(frames);
          if (!parsed) return {
            headerError: BAD_REQUEST,
            error: 'Frames selection is wrong'
          };
          rangeString += `frames=${parsed}`;
        }
        // Get the bytes ranges
        range = handleRange(rangeString, descriptor);
      }
      // It is also able to obtain ranges through the header, when there are no queries
      // This was the default way to receive ranges time ago
      else if (request.headers.range) {
        // Get the bytes ranges
        range = handleRange(request.headers.range, descriptor);
      }
      // In case there is no selection range is no iterable
      else {
        range = handleRange(null, descriptor);
      }
      // Set the final stream to be returned
      let stream;
      // Return a simple stream when asking for the whole file (i.e. range is not iterable)
      // Return an internally managed stream when asking for specific ranges
      const rangedStream = combineDownloadStreams(bucket, descriptor._id, range);
      // Get the output format name
      const transformFormatName = transformFormat.name;
      // When user requests "crd" or "mdcrd" files
      if (transformFormatName === 'mdcrd') {
        // Set a title for the mdcrd file (i.e. the first line)
        const host = request.get('host');
        const config = hostConfig[host];
        let title = config.name + ' - ' + request.params.project;
        if (frames) title += ' - frames: ' + frames;
        if (selection) title += ' - selection: ' + selection;
        title += '\n';
        // Add an extra chunk with the title
        // WARNING: This is important for the correct parsing of this format
        // e.g. VMD skips the first line when reading this format
        const titleStream = Readable.from([title]);
        // Get the atoms per frames count. It is required to add the breakline between frames at the mdcrd format
        // If this data is missing we cannot convert .bin to .mdcrd
        const atomCount = range.atomCount;
        if (!atomCount) return;
        // Start a process to convert the original .bin file to .mdcrd format
        const transformStream = BinToMdcrdStream(atomCount);
        const lengthConverter = BinToMdcrdStream.CONVERTER;
        // Calculate the bytes length in the new format
        // WARNING: The size of the title must be included in the range (and then content-length)
        range.size =
          lengthConverter(range.size, atomCount) + Buffer.byteLength(title);
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
        // Get the number of atoms and frames
        const atomCount = range.atomCount;
        const frameCount = range.frameCount;
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
        : projectData._id;
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
      if (range) {
        // complete potentially missing range info
        if (!range.responseHeaders.find(h => h.startsWith('atoms'))) {
          range.responseHeaders.push(`atoms=*/${descriptor.metadata.atoms}`);
        }
        if (!range.responseHeaders.find(h => h.startsWith('frames'))) {
          range.responseHeaders.push(`frames=*/${descriptor.metadata.frames}`);
        }
        // NEVER FORGET: 'content-range' were disabled and now this data is got from project files
        // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
        //response.set('content-range', range.responseHeaders);

        // NEVER FORGET: This partial content (i.e. 206) makes Chrome fail when downloading data directly from API
        //response.status(PARTIAL_CONTENT);
      }

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
