const Router = require('express').Router;
const mongodb = require('mongodb');

const handler = require('../../../utils/generic-handler');

const fileRouter = Router();

const NOT_FOUND = 404;

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
    return bucket.openDownloadStream(objectId);
  };

  const fileSerializer = (response, stream) => {
    if (!stream) return response.sendStatus(NOT_FOUND);
    response.set('content-type', 'text/plain');
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
