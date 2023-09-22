const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket, ObjectId } = require('mongodb');
const { Readable, PassThrough } = require('stream');
// This function returns an object without the selected omitted attributes
const omit = require('lodash').omit;

const handler = require('../../../utils/generic-handler');
// Converts the stored file (.bin) into human friendly format (chemical/mdcrd)
const BinToMdcrdStream = require('../../../utils/bin-to-mdcrd');
// Converts ranges of different types (e.g. frames or atoms) into a single summarized range of bytes
const handleRange = require('../../../utils/handle-range');
// Returns a simple stream when asking for the whole file
// Returns an internally managed stream when asking for specific ranges
const combineDownloadStreams = require('../../../utils/combine-download-streams');
// Get an automatic mongo query parser based on environment and request
const {
  getProjectQuery,
  getMdIndex,
} = require('../../../utils/get-project-query');
// Returns the selected atom indices as a string ("i1-i1,i2-i2,i3-i3..."")
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
// Returns a pdb filtered according to an NGL selection
const getSelectedPdb = require('../../../utils/get-selection-pdb-through-ngl');
// Translates the frames query string format into a explicit frame selection in string format
const parseQuerystringFrameRange = require('../../../utils/parse-querystring-frame-range');
const consumeStream = require('../../../utils/consume-stream');
const chemfilesConverter = require('../../../utils/bin-to-chemfiles');
// Get the configuration parameters for the different requesting hosts
const hostConfig = require('../../../../config.js').hosts;

const {
  NO_CONTENT,
  BAD_REQUEST,
  NOT_FOUND,
  REQUEST_RANGE_NOT_SATISFIABLE,
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

// Set the standard name of the structure and trajectory files
const STANDARD_STRUCTURE_FILENAME = 'md.imaged.rot.dry.pdb';
const STANDARD_TRAJECTORY_FILENAME = 'trajectory.bin';

// Set a function to ckeck if a string is a mongo id
// WARNING: Do not use the builtin 'ObjectId.isValid'
// WARNING: It returns true with whatever string 12 characters long
const isObjectId = string => /[a-z0-9]{24}/.test(string);

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

const fileRouter = Router({ mergeParams: true });

// The reference to the mongo data base here is passed through the properties (db)
// The connection to the data base is made and comes from the projects index.js script
module.exports = (db, { projects, files }) => {
  // Root
  fileRouter.route('/').get(
    handler({
      async retriever(request) {
        // Return the project which matches the request accession
        const projectData = await projects.findOne(
          getProjectQuery(request),
          // Retrieve only the fields which may include files data
          { projection: { files: true, 'mds.files': true, mdref: true } },
        );
        // If we did not found the project then we stop here
        if (!projectData) return;
        // Check if the request is only for the descriptor
        const descriptorRequested =
          request.body.descriptor !== undefined ||
          request.query.descriptor !== undefined;
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = getMdIndex(request);
        // If project data does not contain the 'mds' field then it means it is in the old format
        if (!projectData.mds) {
          // Make sure no md was requested or raise an error to avoid silent problems
          // User may think each md returns different data otherwise
          if (requestedMdIndex !== null)
            return {
              error:
                'This project has no MDs. Please use the accession or id alone.',
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
        const mdIndex =
          requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
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
        // Get the corresponding MD data and return its analysis names
        const mdData = projectData.mds[mdIndex];
        return mdData.files.map(file => file.name);
      },
      // If there is nothing retrieved or the retrieved has no files, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has files, send the files in the body
      body(response, retrieved) {
        if (retrieved) response.json(retrieved);
        else response.end();
      },
    }),
  );

  // When structure is requested (i.e. .../files/structure)
  // Note that structure may be requested both trough GET and POST methods
  // POST method was implemented to allow long atom selections
  const structureHandler = handler({
    async retriever(request) {
      // Set the bucket, which allows downloading big files from the database
      const bucket = new GridFSBucket(db);
      // Return the project which matches the request accession
      const projectData = await projects.findOne(
        getProjectQuery(request),
        // Retrieve only the fields which may include files data
        {
          projection: {
            _id: true,
            accession: true,
            files: true,
            'mds.files': true,
            mdref: true,
          },
        },
      );
      // If we did not found the project then we stop here
      if (!projectData) return;
      // Set the file descriptor to be found
      let fileId;
      // Get the md index from the request or use the reference MD id in case it is missing
      const requestedMdIndex = getMdIndex(request);
      // If the project has the 'mds' field then it means it has the new format
      // Find the file among the corresponding MD files list
      if (projectData.mds) {
        // Get the MD index, which is the requested index or, if none, the reference index
        const mdIndex =
          requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
        // Get the corresponding MD data and return its analysis names
        const mdData = projectData.mds[mdIndex];
        const file = mdData.files.find(
          file => file.name === STANDARD_STRUCTURE_FILENAME,
        );
        if (file) fileId = file.id;
      }
      // If the project has not the 'mds' field then it means it has the old format
      // Return its analyses, as before
      else {
        // Make sure no md was requested or raise an error to avoid silent problems
        // User may think each md returns different data otherwise
        if (requestedMdIndex !== null) return { noContent: true };
        const file = projectData.files.find(
          file => file.filename === STANDARD_STRUCTURE_FILENAME,
        );
        if (file) fileId = file._id;
      }
      // If the project has no trajectory, stop here
      if (!fileId) return { noContent: true };
      // Save the corresponding file, which is found by object id
      const descriptor = await files.findOne({ _id: fileId });
      // If the object ID is not found in the data base, return here
      if (!descriptor) return { noContent: true };
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
    // If there is an active stream, send range and length content
    headers(response, retrieved) {
      if (!retrieved || !retrieved.descriptor) {
        return response.sendStatus(NOT_FOUND);
      }
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
    // If there is a retrieved stream, start sending data through the stream
    body(response, retrieved, request) {
      // If there is not retreieved stream, return here
      if (!retrieved || !retrieved.stream) return;
      // If the client has aborted the request before the streams starts, destroy the stream
      if (request.aborted) {
        retrieved.stream.destroy();
        return;
      }
      // Manage the stream
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
  fileRouter.route('/structure').get(structureHandler);
  fileRouter.route('/structure').post(structureHandler);

  // When trajectory is requested (i.e. .../files/trajectory)
  // Note that trajectory may be requested both trough GET and POST methods
  // POST method was implemented to allow long atom/frame selections
  const trajectoryHandler = handler({
    async retriever(request) {
      // Set the bucket, which allows downloading big files from the database
      const bucket = new GridFSBucket(db);
      // Return the project which matches the request accession
      const projectData = await projects.findOne(
        getProjectQuery(request),
        // Retrieve only the fields which may include files data
        {
          projection: {
            _id: true,
            accession: true,
            files: true,
            'mds.files': true,
            mdref: true,
          },
        },
      );
      // If we did not found the project then stop here
      if (!projectData) return NOT_FOUND;
      // Set the file descriptor to be found
      let fileId;
      // Get the md index from the request or use the reference MD id in case it is missing
      const requestedMdIndex = getMdIndex(request);
      // If the project has the 'mds' field then it means it has the new format
      // Find the file among the corresponding MD files list
      if (projectData.mds) {
        // Get the MD index, which is the requested index or, if none, the reference index
        const mdIndex =
          requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
        // Get the corresponding MD data and return its analysis names
        const mdData = projectData.mds[mdIndex];
        const file = mdData.files.find(
          file => file.name === STANDARD_TRAJECTORY_FILENAME,
        );
        if (file) fileId = file.id;
      }
      // If the project has not the 'mds' field then it means it has the old format
      // Return its analyses, as before
      else {
        // Make sure no md was requested or raise an error to avoid silent problems
        // User may think each md returns different data otherwise
        if (requestedMdIndex !== null) return { noContent: true };
        const file = projectData.files.find(
          file => file.filename === STANDARD_TRAJECTORY_FILENAME,
        );
        if (file) fileId = file._id;
      }
      // If the project has no trajectory, stop here
      if (!fileId) return { noContent: true };
      // Save the corresponding file, which is found by object id
      const descriptor = await files.findOne({ _id: fileId });
      // If the object ID is not found in the data base, return here
      if (!descriptor) return { noContent: true };
      // Set the format in which data will be sent
      // Format is requested through the query
      const transformFormat = acceptTransformFormat(request.query.format);
      if (!transformFormat)
        return {
          error: {
            header: BAD_REQUEST,
            body:
              'ERROR: Not supported format. Choose one of these: ' +
              Object.keys(trajectoryFormats).join(', '),
          },
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
          // Find the structure file and save its id
          let structureFileId;
          // If the project has the 'mds' field then it means it has the new format
          // Find the file among the corresponding MD files list
          if (projectData.mds) {
            // Get the MD index, which is the requested index or, if none, the reference index
            const mdIndex =
              requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
            // Get the corresponding MD data and return its analysis names
            const mdData = projectData.mds[mdIndex];
            const file = mdData.files.find(
              file => file.name === STANDARD_STRUCTURE_FILENAME,
            );
            if (file) structureFileId = file.id;
          }
          // If the project has not the 'mds' field then it means it has the old format
          // Return its analyses, as before
          else {
            // Make sure no md was requested or raise an error to avoid silent problems
            // User may think each md returns different data otherwise
            if (requestedMdIndex !== null) return { noContent: true };
            const file = projectData.files.find(
              file => file.filename === STANDARD_STRUCTURE_FILENAME,
            );
            if (file) structureFileId = file._id;
          }
          // Open a stream and save it completely into memory
          const pdbFile = await consumeStream(
            bucket.openDownloadStream(structureFileId),
          );
          // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
          const atoms = await getAtomIndices(pdbFile, selection);
          // If no atoms where found, then return here and set the header to NOT_FOUND
          if (!atoms) return { noContent: true };
          // Else, save the atoms indices with the "atoms=" head
          rangeString = `atoms=${atoms}`;
        }
        // In case of frame query
        if (frames) {
          // If data is already saved in the rangeString variable because there was a selection query
          if (rangeString) rangeString += ', '; // Add coma and space to separate the new incoming data
          // Translates the frames query string format into a explicit frame selection in string format
          const parsed = parseQuerystringFrameRange(frames);
          if (!parsed) return { range: -1 }; // This results in a 'BAD_REQUEST' error
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
      const rangedStream = combineDownloadStreams(bucket, fileId, range);
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
    headers(
      response,
      {
        stream,
        descriptor,
        range,
        transformFormat,
        noContent,
        accessionOrId,
        error,
      },
    ) {
      // In case of error
      if (error) return response.status(error.header);
      if (noContent) return response.sendStatus(NO_CONTENT);
      if (range) {
        // When something wrong happend while getting the atoms range
        // If you have a bad request error check that 'request.query.frames' is correct
        if (range === -1) return response.sendStatus(BAD_REQUEST);
        if (range === -2) {
          // NEVER FORGET: 'content-range' was disabled and now this data is got from project files
          // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
          //response.set('content-range', [
          //  `bytes=*/${descriptor.length}`,
          //  `atoms=*/${descriptor.metadata.atoms}`,
          //  `frames=*/${descriptor.metadata.frames}`,
          //]);
          return response.sendStatus(REQUEST_RANGE_NOT_SATISFIABLE);
        }
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

        if (!stream) return response.sendStatus(NOT_FOUND);

        // NEVER FORGET: This partial content (i.e. 206) makes Chrome fail when downloading data directly from API
        //response.status(PARTIAL_CONTENT);
      }

      if (!stream) return response.sendStatus(NOT_FOUND);

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
      if (error) return response.json(error.body);

      if (!stream) return;

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
  fileRouter.route('/trajectory').get(trajectoryHandler);
  fileRouter.route('/trajectory').post(trajectoryHandler);

  // When there is a file parameter
  // e.g. .../files/md.imaged.rot.dry.pdb
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
          // Find the project from the request and, inside this project, find the file named as the request
          // Get the ID from the previously found file and save the file through the ID
          // Return the project which matches the request accession
          const projectData = await projects.findOne(
            getProjectQuery(request),
            // Retrieve only the fields which may include files data
            {
              projection: {
                _id: false,
                files: true,
                'mds.files': true,
                mdref: true,
              },
            },
          );
          // If we did not found the project then stop here
          if (!projectData) return;
          // Get the md index from the request or use the reference MD id in case it is missing
          const requestedMdIndex = getMdIndex(request);
          // If the project has the 'mds' field then it means it has the new format
          // Find the file among the corresponding MD files list
          if (projectData.mds) {
            // Get the MD index, which is the requested index or, if none, the reference index
            const mdIndex =
              requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
            // Get the corresponding MD data and return its analysis names
            const mdData = projectData.mds[mdIndex];
            const file = mdData.files.find(
              file => file.name === request.params.file,
            );
            if (file) fileId = file.id;
          }
          // If the project has not the 'mds' field then it means it has the old format
          // Return its analyses, as before
          else {
            // Make sure no md was requested or raise an error to avoid silent problems
            // User may think each md returns different data otherwise
            if (requestedMdIndex !== null) return;
            const file = projectData.files.find(
              file => file.filename === request.params.file,
            );
            if (file) fileId = file._id;
          }
        }
        // If arrived to that point we still have no oid, assume file doesn't exist
        if (!fileId) return;

        // Save the corresponding file
        const descriptor = await files.findOne({ _id: fileId });
        // If the object ID is not found in the data base, return here
        if (!descriptor) return;

        // Check if the request is only for the descriptor
        const descriptorRequested =
          request.body.descriptor !== undefined ||
          request.query.descriptor !== undefined;

        // Open a stream with the corresponding id only if the descriptr flag was not passed
        const stream =
          !descriptorRequested && bucket.openDownloadStream(fileId);

        return { descriptor, stream, descriptorRequested };
      },
      // If there is an active stream, send range and length content
      headers(response, retrieved) {
        // If we retrieved nothing or we are missing the descriptor then set the 'not found' header
        if (!retrieved || !retrieved.descriptor) {
          return response.sendStatus(NOT_FOUND);
        }
        // If the request is only for the descriptor then there is nothing to do in the header
        if (retrieved.descriptorRequested) return;
        const contentRanges = [`bytes=*/${retrieved.descriptor.length}`];
        if (retrieved.descriptor.metadata.frames) {
          contentRanges.push(
            `frames=*/${retrieved.descriptor.metadata.frames}`,
          );
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
      // If there is a retrieved stream, start sending data through the stream
      body(response, retrieved, request) {
        // If we retrieved nothing or we are missing the descriptor then there is nothing to do
        if (!retrieved || !retrieved.descriptor) return;
        // If the request is only for the descriptor then there is nothing to do in the header
        if (retrieved.descriptorRequested)
          return response.json(retrieved.descriptor);
        // If there is not retreieved stream then return here
        if (!retrieved.stream) return;
        // If the client has aborted the request before the streams starts, destroy the stream
        if (request.aborted) {
          retrieved.stream.destroy();
          return;
        }
        // Manage the stream
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
