const Router = require('express').Router;
const { GridFSBucket, ObjectId } = require('mongodb');
const omit = require('lodash').omit;

const handler = require('../../../utils/generic-handler');
const handleRange = require('../../../utils/handle-range');
const combineDownloadStreams = require('../../../utils/combine-download-streams');
const addMinMaxSize = require('../../../utils/add-min-max-size');
const publishedFilter = require('../../../utils/published-filter');
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');
const {
  PARTIAL_CONTENT,
  BAD_REQUEST,
  NOT_FOUND,
  REQUEST_RANGE_NOT_SATISFIABLE,
} = require('../../../utils/status-codes');

const fileRouter = Router();

module.exports = (db, { projects }) => {
  // root
  const rootRetriever = (_, { project }) =>
    projects.findOne(
      // filter
      augmentFilterWithIDOrAccession(publishedFilter, project),
      // options
      { projection: { _id: false, files: true } },
    );

  const rootSerializer = (response, data) => {
    if (!data) return response.sendStatus(NOT_FOUND);
    response.json(
      data.files.map(file => omit(file, ['chunkSize', 'uploadDate'])),
    );
  };

  // file
  const fileRetriever = async (request, { project }) => {
    const files = db.collection('fs.files');
    const bucket = new GridFSBucket(db);

    let oid;
    if (ObjectId.isValid(request.params.file)) {
      // if using mongo ID in URL
      oid = ObjectId(request.params.file);
    } else {
      // if it wasn't a valid object id, assume it was a file name
      const projectDoc = await projects.findOne(
        // filter
        augmentFilterWithIDOrAccession(publishedFilter, project),
        // options
        { projection: { _id: true, files: true } },
      );
      if (!projectDoc) return;
      oid = ObjectId(
        projectDoc.files.find(file => file.filename === request.params.file)
          ._id,
      );
    }

    const descriptor = await files.findOne(oid);

    const range =
      request.headers.range &&
      addMinMaxSize(handleRange(request.headers.range, descriptor));

    let stream;
    if (!range || typeof range === 'object') {
      stream = combineDownloadStreams(bucket, oid, range);
    }
    return { stream, descriptor, range };
  };

  const fileSerializer = (response, { stream, descriptor, range }, request) => {
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
      // completely potentially missing range info
      if (!range.responseHeaders.find(h => h.startsWith('atoms'))) {
        range.responseHeaders.push(`atoms=*/${descriptor.metadata.atoms}`);
      }
      if (!range.responseHeaders.find(h => h.startsWith('frames'))) {
        range.responseHeaders.push(`frames=*/${descriptor.metadata.frames}`);
      }
      response.set('content-range', range.responseHeaders);

      if (!stream) return response.sendStatus(NOT_FOUND);

      response.status(PARTIAL_CONTENT);
    }

    if (!stream) return response.sendStatus(NOT_FOUND);

    response.set('content-length', range ? range.size : descriptor.length);
    if (descriptor.contentType) {
      response.set('content-type', descriptor.contentType);
    }

    response.set('accept-ranges', ['bytes', 'atoms', 'frames']);

    stream.on('data', response.write.bind(response));
    stream.on('error', () => response.sendStatus(NOT_FOUND));
    stream.on('end', response.end.bind(response));

    request.on('close', stream.destroy.bind(stream));
  };

  // handlers
  fileRouter.route('/').get(handler(rootRetriever, rootSerializer));

  fileRouter.route('/:file').get(handler(fileRetriever, fileSerializer));

  return fileRouter;
};
