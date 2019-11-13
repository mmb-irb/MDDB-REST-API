const Router = require('express').Router;
// GridFSBucket manages the saving of files bigger than 16 Mb, splitting them into 4 Mb fragments (chunks)
const { GridFSBucket, ObjectId } = require('mongodb');
// This function returns an object without the selected omitted attributes
const omit = require('lodash').omit;

const handler = require('../../../utils/generic-handler');
// Converts the stored file (.bin) into web friendly format (chemical/x-trj)
const BinToTrjStream = require('../../../utils/bin-to-trj');
const handleRange = require('../../../utils/handle-range');
const combineDownloadStreams = require('../../../utils/combine-download-streams');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../../utils/published-filter');
// Adds the project associated ID from mongo db to the provided object
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');
// Returns the selected atom indices as a string ("i1-i1,i2-i2,i3-i3..."")
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
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

const TRJ_TYPE = 'chemical/x-trj';

// Check if the requested files meet the accepted formats, which are provided by the request header
// If so, send the format name. Else, send null
const acceptTransformFormat = (requested, filename) => {
  const _requested = (requested || '').toLowerCase();
  const _filename = filename.toLowerCase();
  // If "trj" or "traj" formats are accepted and the requestd file is a ".bin" return the "trj" type
  if (_requested.includes('trj') || _requested.includes('traj')) {
    if (_filename.endsWith('.bin')) return TRJ_TYPE;
  }
  // added (possible future) accepted transformation formats here
  //
  // default case, not an accepted format, just transform
  return null;
};

const fileRouter = Router({ mergeParams: true });

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
              omit(file, ['chunkSize', 'uploadDate']),
            ),
          );
        }
      },
    }),
  );
  // This function saves the "_id" and the "files" attributes form the project which matches the request accession
  const getProject = project =>
    projects.findOne(augmentFilterWithIDOrAccession(publishedFilter, project), {
      projection: { _id: true, files: true },
    });

  // When there is a trajectory parameter (i.e. .../files/trajectory)
  fileRouter.route('/trajectory').get(
    handler({
      async retriever(request) {
        const files = db.collection('fs.files'); // Save all files from mongo
        const bucket = new GridFSBucket(db); // Process all files splitting them in 4 Mb fragments

        let projectDoc;
        // Find the project from the request and, inside this project, find the file 'trajectory.bin'
        // Get the ID from the previously found file and save the file through the ID
        projectDoc = await getProject(request.params.project); // Finds the project by the accession
        if (!projectDoc) return; // If there is no projectDoc stop here
        const oid = ObjectId(
          projectDoc.files.find(file => file.filename === 'trajectory.bin')._id,
        );

        // Save the corresponding file
        const descriptor = await files.findOne(oid);
        // Set the format in which data will be sent
        const transformFormat = acceptTransformFormat(
          request.headers.accept,
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
            if (!projectDoc)
              projectDoc = await getProject(request.params.project);
            if (!projectDoc) return; // If there is no project stop here
            // Get the ID from the file 'md.imaged.rot.dry.pdb' and save it through the ID
            const oid = ObjectId(
              projectDoc.files.find(
                file => file.filename === 'md.imaged.rot.dry.pdb',
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
            // If data is already saved in the rangeString variable because there was a selection query
            if (rangeString) rangeString += ', '; // Add coma and space to separate the new incoming data
            // Translates the frames query string format into a explicit frame selection in string format
            const parsed = parseQuerystringFrameRange(request.query.frames);
            if (!parsed) return { range: -1 }; // bad request
            rangeString += `frames=${parsed}`;
          }
          range = handleRange(rangeString, descriptor);
        } else if (request.headers.range) {
          range = handleRange(request.headers.range, descriptor);
        }

        let stream;
        let lengthMultiplier = x => x;
        if (!range || typeof range === 'object') {
          const rangedStream = combineDownloadStreams(bucket, oid, range);

          if (transformFormat === TRJ_TYPE) {
            const transformStream = BinToTrjStream();

            rangedStream.pipe(transformStream);
            transformStream.on('close', () => rangedStream.destroy());
            request.on('close', () => rangedStream.destroy());

            lengthMultiplier = BinToTrjStream.MULTIPLIER;
            stream = transformStream;
          } else {
            stream = rangedStream;
          }
        }
        return { stream, descriptor, range, transformFormat, lengthMultiplier };
      },
      headers(
        response,
        {
          stream,
          descriptor,
          range,
          transformFormat,
          lengthMultiplier,
          noContent,
        },
      ) {
        if (noContent) return response.sendStatus(NO_CONTENT);
        if (range) {
          if (range === -1) return response.sendStatus(BAD_REQUEST);
          if (range === -2) {
            response.set('content-range', [
              `bytes=*/${descriptor.length}`,
              `atoms=*/${descriptor.metadata.atoms}`,
              `frames=*/${descriptor.metadata.frames}`,
            ]);
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
          response.set('content-range', range.responseHeaders);

          if (!stream) return response.sendStatus(NOT_FOUND);

          response.status(PARTIAL_CONTENT);
        }

        if (!stream) return response.sendStatus(NOT_FOUND);

        response.set(
          'content-length',
          lengthMultiplier(range ? range.size : descriptor.length),
        );
        if (descriptor.contentType) {
          response.set(
            'content-type',
            transformFormat || descriptor.contentType,
          );
        }

        response.set('accept-ranges', ['bytes', 'atoms', 'frames']);
      },
      body(response, { stream }, request) {
        if (!stream) return;

        if (request.aborted) {
          stream.destroy();
          return;
        }

        stream.on('data', data => response.write(data));
        stream.on('error', error => console.error(error));
        stream.on('end', data => response.end(data));

        request.on('close', () => stream.destroy());
      },
    }),
  );

  // When there is a file parameter (e.g. .../files/5d08c0d8174bf85a17e00861)
  fileRouter.route('/:file').get(
    handler({
      async retriever(request) {
        const files = db.collection('fs.files');
        const bucket = new GridFSBucket(db);

        let oid;
        if (ObjectId.isValid(request.params.file)) {
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
            projectDoc.files.find(file => file.filename === request.params.file)
              ._id,
          );
        }
        // If arrived to that point we still have no oid, assume file doesn't exist
        if (!oid) return;

        // Save the corresponding file
        const descriptor = await files.findOne(oid);
        // If the object ID is not found in the data bsae, return here
        if (!descriptor) return;

        // Open a stream with the corresponding ID
        const stream = bucket.openDownloadStream(oid);

        return { descriptor, stream };
      },
      // If there is an active stream, send range and length content
      headers(response, retrieved) {
        if (!retrieved || !retrieved.descriptor)
          return response.sendStatus(NOT_FOUND);
        response.set('content-range', `bytes=*/${retrieved.descriptor.length}`);
        response.set('content-length', retrieved.descriptor.length);
        // Send content type also if known
        if (retrieved.descriptor.contentType) {
          response.set('content-type', retrieved.descriptor.contentType);
        }
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
        retrieved.stream.pipe(response);
        // If there is an error, send the error to the console and end the data transfer
        retrieved.stream.on('error', error => {
          console.error(error);
          response.end();
        });
        // Close the stream on request
        request.on('close', () => retrieved.stream.destroy());
      },
    }),
  );

  return fileRouter;
};
