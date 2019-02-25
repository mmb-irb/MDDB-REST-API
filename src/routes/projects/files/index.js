const Router = require('express').Router;
const mongodb = require('mongodb');
const parseRange = require('range-parser');

const handler = require('../../../utils/generic-handler');
const combineDownloadStreams = require('../../../utils/combine-download-streams');
const addMinMaxSize = require('../../../utils/add-min-max-size');

const {
  PARTIAL_CONTENT,
  BAD_REQUEST,
  NOT_FOUND,
  REQUEST_RANGE_NOT_SATISFIABLE,
} = require('../../../utils/status-codes');

const fileRouter = Router();

module.exports = (db, model) => {
  // root
  const rootRetriever = (_, { project }) =>
    model.findOne(
      { _id: project },
      {
        projection: {
          _id: false,
          files: true,
        },
      },
    );

  const rootSerializer = (response, data) => {
    if (!data) return response.sendStatus(NOT_FOUND);
    response.json(data);
  };

  // file
  const fileRetriever = async (request, { project }) => {
    const files = db.collection('fs.files');
    const bucket = new mongodb.GridFSBucket(db);
    let objectId;
    try {
      // if using the mongo ID in the URL
      objectId = mongodb.ObjectId(request.params.file);
    } catch (_) {
      // if it wasn't a valid object id, assume it was a file name
      const projectFiles = await model.findOne(
        { _id: project },
        {
          projection: {
            _id: false,
            files: true,
          },
        },
      );
      if (!projectFiles) return;
      objectId = mongodb.ObjectId(
        projectFiles.files.find(file => file.filename === request.params.file)
          ._id,
      );
    }
    const descriptor = await files.findOne({ _id: objectId });
    const range =
      request.headers.range &&
      addMinMaxSize(
        parseRange(descriptor.length, request.headers.range, { combine: true }),
        descriptor.length,
      );
    let stream;
    if (!range || typeof range === 'object') {
      console.log(request.headers.range, range);
      stream = combineDownloadStreams(bucket, objectId, range);
    }
    return { stream, descriptor, range };
  };

  const fileSerializer = (response, { stream, descriptor, range }) => {
    if (!stream) return response.sendStatus(NOT_FOUND);
    if (range) {
      if (range === -1) return response.sendStatus(BAD_REQUEST);
      if (range === -2) {
        response.set('content-range', `bytes=*/${descriptor.length}`);
        return response.sendStatus(REQUEST_RANGE_NOT_SATISFIABLE);
      }

      response.set('content-range', range.responseHeader);
      response.status(PARTIAL_CONTENT);
    }
    response.set('content-length', range ? range.size : descriptor.length);
    if (descriptor.contentType) {
      response.set('content-type', descriptor.contentType);
    }

    response.set('accept-ranges', 'bytes');

    stream.on('data', response.write.bind(response));
    stream.on('error', () => response.sendStatus(NOT_FOUND));
    stream.on('end', response.end.bind(response));
  };

  // handlers
  fileRouter.route('/').get(handler(rootRetriever, rootSerializer));

  fileRouter.route('/:file').get(handler(fileRetriever, fileSerializer));

  return fileRouter;
};
