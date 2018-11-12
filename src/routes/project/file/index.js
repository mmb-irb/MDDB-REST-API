const fs = require('fs');

const Router = require('express').Router;
const mongodb = require('mongodb');

const fileRouter = Router();

const NOT_FOUND = 404;

module.exports = (db, model) => {
  fileRouter.route('/').get(async (request, response) => {
    const projectFiles = await model.findOne(
      mongodb.ObjectId(response.locals.project),
      {
        projection: {
          _id: 0,
          files: 1,
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
      objectId = mongodb.ObjectId(request.params.file);
    } catch (_) {
      const projectFiles = await model.findOne(
        mongodb.ObjectId(response.locals.project),
        {
          projection: {
            _id: 0,
            files: 1,
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
