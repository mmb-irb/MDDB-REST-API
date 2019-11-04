const Router = require('express').Router;
const { GridFSBucket, ObjectId } = require('mongodb');
const omit = require('lodash').omit;

const handler = require('../../../utils/generic-handler');
const BinToTrjStream = require('../../../utils/bin-to-trj');
const handleRange = require('../../../utils/handle-range');
const combineDownloadStreams = require('../../../utils/combine-download-streams');
const addMinMaxSize = require('../../../utils/add-min-max-size');
const publishedFilter = require('../../../utils/published-filter');
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
const parseQuerystringFrameRange = require('../../../utils/parse-querystring-frame-range');
const {
  NO_CONTENT,
  PARTIAL_CONTENT,
  BAD_REQUEST,
  NOT_FOUND,
  REQUEST_RANGE_NOT_SATISFIABLE,
} = require('../../../utils/status-codes');

const TRJ_TYPE = 'chemical/x-trj';

const acceptTransformFormat = (requested, filename) => {
  const _requested = (requested || '').toLowerCase();
  const _filename = filename.toLowerCase();
  if (_requested.includes('trj') || _requested.includes('traj')) {
    if (_filename.endsWith('.bin')) return TRJ_TYPE;
  }
  // Added (possible future) accepted transformation formats here
  //
  // Default case, not an accepted format, just transform
  return null;
};

const fileRouter = Router({ mergeParams: true });

module.exports = (db, { projects }) => {
  // root
  fileRouter.route('/').get(
    handler({
      retriever(request) {
        return projects.findOne(
          // filter
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // options
          { projection: { _id: false, files: true } },
        );
      },
      headers(response, retrieved) {
        if (!(retrieved && retrieved.files)) response.sendStatus(NOT_FOUND);
      },
      body(response, retrieved) {
        if (retrieved && retrieved.files) {
          response.json(
            retrieved.files.map(file =>
              omit(file, ['chunkSize', 'uploadDate']),
            ),
          );
        }
      },
    }),
  );

  const getProject = project =>
    projects.findOne(
      // filter
      augmentFilterWithIDOrAccession(publishedFilter, project),
      // options
      { projection: { _id: true, files: true } },
    );

  // file
  fileRouter.route('/:file').get(
    handler({
      async retriever(request) {
        const files = db.collection('fs.files');
        const bucket = new GridFSBucket(db);

        let oid;
        let projectDoc;
        if (ObjectId.isValid(request.params.file)) {
          // if using mongo ID in URL
          oid = ObjectId(request.params.file);
        } else {
          // if it wasn't a valid object id, assume it was a file name
          projectDoc = await getProject(request.params.project);
          if (!projectDoc) return;
          oid = ObjectId(
            projectDoc.files.find(file => file.filename === request.params.file)
              ._id,
          );
        }

        const descriptor = await files.findOne(oid);

        const transformFormat = acceptTransformFormat(
          request.headers.accept,
          descriptor.filename,
        );

        // range handling
        // range in querystring > range in headers
        // but we do transform the querystring format into the headers format
        let range;
        if (request.query.selection || request.query.frames) {
          let rangeString = '';
          if (request.query.selection) {
            if (projectDoc)
              projectDoc = await getProject(request.params.project);
            if (!projectDoc) return;
            const oid = ObjectId(
              projectDoc.files.find(
                file => file.filename === 'md.imaged.rot.dry.pdb',
              )._id,
            );

            // open a stream and read it completely into memory
            const pdbFile = await new Promise((resolve, reject) => {
              const stream = bucket.openDownloadStream(oid);
              const buffers = [];
              stream.on('data', chunk => buffers.push(chunk));
              stream.on('error', reject);
              stream.on('end', () => resolve(Buffer.concat(buffers)));
            });

            const atoms = await getAtomIndices(
              pdbFile,
              request.query.selection,
            );
            if (!atoms) return { noContent: true };
            rangeString = `atoms=${atoms}`;
          }
          if (request.query.frames) {
            if (rangeString) rangeString += ', ';
            const parsed = parseQuerystringFrameRange(request.query.frames);
            if (!parsed) return { range: -1 }; // bad request
            rangeString += `frames=${parsed}`;
          }
          range = addMinMaxSize(handleRange(rangeString, descriptor));
        } else if (request.headers.range) {
          range = addMinMaxSize(handleRange(request.headers.range, descriptor));
        }

        let stream;
        let lengthMultiplier = x => x;
        if (!range || typeof range === 'object') {
          stream = combineDownloadStreams(bucket, oid, range);
          if (transformFormat === TRJ_TYPE) {
            stream = stream.pipe(BinToTrjStream());
            lengthMultiplier = BinToTrjStream.MULTIPLIER;
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

        stream.on('data', data => response.write(data));
        stream.on('error', () => response.sendStatus(NOT_FOUND));
        stream.on('end', data => response.end(data));

        request.on('close', () => stream.destroy());
      },
    }),
  );

  return fileRouter;
};
