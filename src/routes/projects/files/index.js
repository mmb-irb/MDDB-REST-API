const Router = require('express').Router;
const mongodb = require('mongodb');

const fileRouter = Router();

const NOT_FOUND = 404;

module.exports = (db, model) => {
  fileRouter.route('/').get(async (_, response) => {
    const projectFiles = await model.findOne(
      { _id: response.locals.project },
      {
        projection: {
          _id: false,
          files: true,
        },
      },
    );
    if (!projectFiles) return response.sendStatus(NOT_FOUND);
    response.json(projectFiles);
  });

  fileRouter.route('/:file').get(async (request, response) => {
    const bucket = new mongodb.GridFSBucket(db);
    let objectId;
    try {
      // if using the mongo ID in the URL
      objectId = mongodb.ObjectId(request.params.file);
    } catch (_) {
      // if it wasn't a valid object id, assume it was a file name
      const projectFiles = await model.findOne(
        { _id: response.locals.project },
        {
          projection: {
            _id: false,
            files: true,
          },
        },
      );
      if (!projectFiles) return response.sendStatus(NOT_FOUND);
      objectId = mongodb.ObjectId(
        projectFiles.files.find(file => file.filename === request.params.file)
          ._id,
      );
    }
    const stream = bucket.openDownloadStream(objectId);
    response.set('content-type', 'text/plain');
    response.set('accept-ranges', 'bytes');
    stream.on('data', response.write.bind(response));
    stream.on('error', () => response.sendStatus(NOT_FOUND));
    stream.on('end', response.end.bind(response));
  });

  return fileRouter;
};
