const Router = require('express').Router;
const mongodb = require('mongodb');
const parseRange = require('range-parser');

const handler = require('../../../utils/generic-handler');
const addMinMaxSize = require('../../../utils/add-min-max-size');

const {
  PARTIAL_CONTENT,
  BAD_REQUEST,
  NOT_FOUND,
  REQUEST_RANGE_NOT_SATISFIABLE,
} = require('../../../utils/status-codes');

const fileRouter = Router();

// assume we already starting streaming at range.min
const responseWriterForRange = (range, response) => {
  // TODO: implement multiple range values
  // currentRangeIndex = 0;
  // currentFileIndex = range[currentRangeIndex].min;
  return buffer => {
    // let finalFileIndex = currentRangeIndex + buffer.length;
    // if (finalFileIndex <= range[currentRangeIndex].end) {}
    // console.log(buffer, buffer.length);
    response.write(buffer);
  };
};

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
    const metadata = await files.findOne({ _id: objectId });
    const range =
      request.headers.range &&
      addMinMaxSize(
        parseRange(metadata.length, request.headers.range, { combine: true }),
        metadata.length,
      );
    let options;
    if (range && typeof range === 'object') {
      options = { start: range.min, end: range.max + 1 };
    }
    const stream = bucket.openDownloadStream(objectId, options);
    return { stream, metadata, range };
  };

  const fileSerializer = (response, { stream, metadata, range }) => {
    if (!stream) return response.sendStatus(NOT_FOUND);
    if (range) {
      if (range === -1) return response.sendStatus(BAD_REQUEST);
      if (range === -2) {
        response.set('content-range', `*/${metadata.length}`);
        return response.sendStatus(REQUEST_RANGE_NOT_SATISFIABLE);
      }

      response.set('content-range', range.responseHeader);
      response.status(PARTIAL_CONTENT);
    }
    response.set('content-type', 'text/plain');
    response.set('content-length', range ? range.size : metadata.length);
    response.set('accept-ranges', 'bytes');
    stream.on(
      'data',
      range
        ? responseWriterForRange(range, response)
        : response.write.bind(response),
    );
    stream.on('error', () => response.sendStatus(NOT_FOUND));
    stream.on('end', response.end.bind(response));
  };

  // handlers
  fileRouter.route('/').get(handler(rootRetriever, rootSerializer));

  fileRouter.route('/:file').get(handler(fileRetriever, fileSerializer));

  return fileRouter;
};
