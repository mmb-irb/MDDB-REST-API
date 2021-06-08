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
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../../utils/published-filter');
// Adds the project associated ID from mongo db to the provided object
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');
// Returns the selected atom indices as a string ("i1-i1,i2-i2,i3-i3..."")
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
// Returns a pdb filtered according to an NGL selection
const getSelectedPdb = require('../../../utils/get-selection-pdb-through-ngl');
// Translates the frames query string format into a explicit frame selection in string format
const parseQuerystringFrameRange = require('../../../utils/parse-querystring-frame-range');
const consumeStream = require('../../../utils/consume-stream');

const {
  NO_CONTENT,
  PARTIAL_CONTENT,
  BAD_REQUEST,
  NOT_FOUND,
  REQUEST_RANGE_NOT_SATISFIABLE,
} = require('../../../utils/status-codes');

const MDCRD_TYPE = 'chemical/x-mdcrd';

// Set the standard name of the structure and trajectory files
const STANDARD_STRUCTURE_FILENAME = 'md.imaged.rot.dry.pdb';

// Set a function to ckeck if a string is a mongo id
// WARNING: Do not use the builtin 'ObjectId.isValid'
// WARNING: It returns true with whatever string 12 characters long
const isObjectId = string => /[a-z0-9]{24}/.test(string);

// Check if the requested files meet the accepted formats, which are provided by the request header
// If so, send the format name. Else, send null
const acceptTransformFormat = (requested, filename) => {
  const _requested = (requested || '').toLowerCase();
  const _filename = filename.toLowerCase();
  // _requested is a string sent by the header which includes the names of all accepted formats
  // If "crd" or "mdcrd" are requested and the requested file is a ".bin" return the "mdcrd" type
  if (_requested.includes('crd') || _requested.includes('mdcrd')) {
    if (_filename.endsWith('.bin')) return MDCRD_TYPE;
  }
  // added (possible future) accepted transformation formats here
  //
  // default case, not an accepted format, just transform
  return null; // Data will be sent in binary format
};

const fileRouter = Router({ mergeParams: true });

// The reference to the mongo data base here is passed through the properties (db)
// The connection to the data base is made and comes from the projects index.js script
module.exports = (db, { projects }) => {
  // Root
  fileRouter.route('/').get(
    handler({
      retriever(request) {
        // Return the project which matches the request accession
        return projects.findOne(
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // But return only the "files" attribute
          { projection: { _id: false, files: true } },
        );
      },
      // If there is nothing retrieved or the retrieved has no files, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!(retrieved && retrieved.files)) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has files, send the files in the body
      body(response, retrieved) {
        if (retrieved && retrieved.files) {
          response.json(
            // Remove the "chunkSize" and the "uploadDate" attributes from each file
            retrieved.files.map(file =>
              omit(file, ['chunkSize', 'uploadDate', 'dbConnection_id']),
            ),
          );
        } else response.end();
      },
    }),
  );
  // This function finds the project which matches the request accession
  // When found, saves the project object ID, accession and files
  const getProject = project =>
    projects.findOne(
      // Returns a filter with the publishedFilter attributes and the project ObjectID
      augmentFilterWithIDOrAccession(publishedFilter, project),
      // Declare that we only want the id and files to be returned from findOne()
      { projection: { _id: true, accession: true, files: true } },
    );

  // When structure is requested (i.e. .../files/structure)
  fileRouter.route('/structure').get(
    handler({
      async retriever(request) {
        const bucket = new GridFSBucket(db);
        // Finds the project by the accession
        const projectDoc = await getProject(request.params.project);
        if (!projectDoc) return; // If there is no projectDoc stop here
        const accessionOrId = projectDoc.accession
          ? projectDoc.accession.toLowerCase()
          : projectDoc._id;
        // Get the object id of the project structure
        const oid = ObjectId(
          (
            projectDoc.files.find(
              file => file.filename === STANDARD_STRUCTURE_FILENAME,
            ) || {}
          )._id,
        );
        // If there is no oid at this point it means there is no structure file
        if (!oid) return;
        // Save the corresponding file
        const descriptor = await db.collection('fs.files').findOne(oid);
        // If the object ID is not found in the data base, return here
        if (!descriptor) return;

        // Open a stream with the corresponding ID
        let stream = bucket.openDownloadStream(oid);

        // In case of selection query
        if (request.query.selection) {
          // Open a stream and save it completely into memory
          const pdbFile = await consumeStream(bucket.openDownloadStream(oid));
          // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
          const selectedPdb = await getSelectedPdb(
            pdbFile,
            request.query.selection,
          );
          // Selected pdb will be never null, since an empty pdb file would have header and end
          // Now convert the string pdb to a stream
          //const bufferPdb = Buffer.from(selectedPdb, 'base64');
          const bufferPdb = Buffer.from(selectedPdb, 'utf-8');
          stream = Readable.from([bufferPdb]);
          // Modify the original length
          descriptor.length = bufferPdb.length;
        } else {
          stream = bucket.openDownloadStream(oid);
        }

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
    }),
  );

  // When trajectory is requested (i.e. .../files/trajectory)
  fileRouter.route('/trajectory').get(
    handler({
      async retriever(request) {
        // The bucket is used to process files splitting them in 4 Mb fragments
        const bucket = new GridFSBucket(db);
        let projectDoc;
        // Find the project from the request and, inside this project, find the file 'trajectory.bin'
        // Get the ID from the previously found file and save the file through the ID
        projectDoc = await getProject(request.params.project); // Finds the project by the accession
        if (!projectDoc) return NOT_FOUND; // If there is no projectDoc stop here
        const accessionOrId = projectDoc.accession
          ? projectDoc.accession.toLowerCase()
          : projectDoc._id;
        const cursor = projectDoc.files.find(
          file => file.filename === 'trajectory.bin',
        );
        if (!cursor) return { noContent: true }; // If the project has no trajectory, stop here
        const oid = ObjectId(cursor._id);

        // Save the corresponding file, which is found by object id
        const descriptor = await db.collection('fs.files').findOne(oid);
        // Set the format in which data will be sent
        const transformFormat = acceptTransformFormat(
          // Format is requested through query
          request.query.format,
          descriptor.filename,
        );

        // range handling
        // range in querystring > range in headers
        // but we do transform the querystring format into the headers format

        // When there is a selection or frame query (e.g. .../files/trajectory?selection=x)
        let range;
        if (request.query.selection || request.query.frames) {
          let rangeString = '';
          // In case of selection query
          if (request.query.selection) {
            // Save the project from the request if it is not saved yet
            // DANI: Esto no tiene sentido ¿no? ya deberíamos tener el proyecto de arriba
            if (!projectDoc)
              projectDoc = await getProject(request.params.project);
            if (!projectDoc) return; // If there is no project stop here
            // Get the ID from the structure file and save it through the ID
            const oid = ObjectId(
              projectDoc.files.find(
                file => file.filename === STANDARD_STRUCTURE_FILENAME,
              )._id,
            );
            // Open a stream and save it completely into memory
            const pdbFile = await consumeStream(bucket.openDownloadStream(oid));
            // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
            const atoms = await getAtomIndices(
              pdbFile,
              request.query.selection,
            );
            // If no atoms where found, then return here and set the header to NOT_FOUND
            if (!atoms) return { noContent: true };
            // Else, save the atoms indices with the "atoms=" head
            rangeString = `atoms=${atoms}`;
          }
          // In case of frame query
          if (request.query.frames) {
            // If data is already saved in the rangeStrinMDCRD_TYPEg variable because there was a selection query
            if (rangeString) rangeString += ', '; // Add coma and space to separate the new incoming data
            // Translates the frames query string format into a explicit frame selection in string format
            const parsed = parseQuerystringFrameRange(request.query.frames);
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
        const rangedStream = combineDownloadStreams(bucket, oid, range);
        // When user requests "crd" or "mdcrd" files
        if (transformFormat === MDCRD_TYPE) {
          // Set a title for the mdcrd file (i.e. the first line)
          let title = process.env.DOCS_DB_NAME + ' - ' + request.params.project;
          if (request.query.frames)
            title += ' - frames: ' + request.query.frames;
          if (request.query.selection)
            title += ' - selection: ' + request.query.selection;
          title += '\n';
          // Add an extra chunk with the title
          // WARNING: This is important for the correct parsing of this format
          // e.g. VMD skips the first line when reading this format
          const titleStream = Readable.from([title]);
          // Start a process to convert the original .bin file to .mdcrd format
          const transformStream = BinToMdcrdStream();
          const lengthMultiplier = BinToMdcrdStream.MULTIPLIER;
          // WARNING: The size of the title must be included in the range (and then content-length)
          range.size = lengthMultiplier(range.size);
          range.size += Buffer.byteLength(title);
          // Set a new stream which is ready to be destroyed
          // It is destroyed when the .bin to .mdcrd process or the client request are over
          rangedStream.pipe(transformStream);
          transformStream.on('close', () => rangedStream.destroy());
          request.on('close', () => rangedStream.destroy());
          // Combine both the title and the main data streams
          let combined = new PassThrough();
          combined = titleStream.pipe(combined, { end: false });
          combined = transformStream.pipe(combined, { end: false });
          transformStream.once('end', () => combined.emit('end'));
          // Return the .bin to .mdcrd process stream
          stream = combined;
        } else {
          stream = rangedStream;
        }
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
        },
      ) {
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
            range.responseHeaders.push(
              `frames=*/${descriptor.metadata.frames}`,
            );
          }
          // NEVER FORGET: 'content-range' were disabled and now this data is got from project files
          // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
          //response.set('content-range', range.responseHeaders);

          if (!stream) return response.sendStatus(NOT_FOUND);

          response.status(PARTIAL_CONTENT);
        }

        if (!stream) return response.sendStatus(NOT_FOUND);

        // Send the expected bytes length of the file
        // WARNING: If sent bytes are less than specified the download will fail with error signal
        // WARNING: If sent bytes are more than specified the download will succed but it will be cutted
        response.set('content-length', range.size);
        if (descriptor.contentType) {
          response.set(
            'content-type',
            transformFormat || descriptor.contentType,
          );
        }
        // Set the output filename according to some standards
        let format = 'bin';
        if (transformFormat === MDCRD_TYPE) format = 'mdcrd';
        const filename = accessionOrId + '_trajectory.' + format;
        response.setHeader(
          'Content-disposition',
          `attachment; filename=${filename}`,
        );

        response.set('accept-ranges', ['bytes', 'atoms', 'frames']);
      },
      body(response, { stream }, request) {
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
    }),
  );

  // When there is a file parameter (e.g. .../files/5d08c0d8174bf85a17e00861)
  fileRouter.route('/:file').get(
    handler({
      async retriever(request) {
        const bucket = new GridFSBucket(db);

        let oid;
        if (isObjectId(request.params.file)) {
          // If using mongo ID in the request (URL)
          // Saves the mongo ID corresponding file
          oid = ObjectId(request.params.file);
        } else {
          // If it was not a valid mongo ID, assume it was a file name
          // Find the project from the request and, inside this project, find the file named as the request
          // Get the ID from the previously found file and save the file through the ID
          const projectDoc = await getProject(request.params.project); // Finds the project by the accession
          if (!projectDoc) return; // If there is no projectDoc stop here
          oid = ObjectId(
            (
              projectDoc.files.find(
                file => file.filename === request.params.file,
              ) || {}
            )._id,
          );
        }
        // If arrived to that point we still have no oid, assume file doesn't exist
        if (!oid) return;

        // Save the corresponding file
        const descriptor = await db.collection('fs.files').findOne(oid);
        // If the object ID is not found in the data base, return here
        if (!descriptor) return;

        // Open a stream with the corresponding ID
        const stream = bucket.openDownloadStream(oid);

        return { descriptor, stream };
      },
      // If there is an active stream, send range and length content
      headers(response, retrieved) {
        if (!retrieved || !retrieved.descriptor) {
          return response.sendStatus(NOT_FOUND);
        }
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
    }),
  );

  return fileRouter;
};
