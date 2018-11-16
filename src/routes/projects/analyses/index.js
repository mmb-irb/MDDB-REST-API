const Router = require('express').Router;
const mongodb = require('mongodb');

const fileRouter = Router();

const NOT_FOUND = 404;

module.exports = (db, model) => {
  fileRouter.route('/').get(async (_, response) => {
    const projectAnalyses = await model.findOne(
      { _id: response.locals.project },
      {
        projection: {
          _id: false,
          analyses: true,
        },
      },
    );
    if (!(projectAnalyses && projectAnalyses.analyses)) {
      return response.sendStatus(NOT_FOUND);
    }
    response.json(projectAnalyses.analyses);
  });

  fileRouter.route('/:analysis').get(async (request, response) => {
    const bucket = new mongodb.GridFSBucket(db);

    // if it wasn't a valid object id, assume it was a file name
    const projectAnalyses = await model.findOne(
      { _id: response.locals.project },
      {
        projection: {
          _id: false,
          [`analyses.${request.params.analysis}`]: true,
        },
      },
    );
    if (
      !(
        projectAnalyses &&
        projectAnalyses.analyses &&
        projectAnalyses.analyses[request.params.analysis]
      )
    ) {
      return response.sendStatus(NOT_FOUND);
    }
    response.json(projectAnalyses.analyses[request.params.analysis]);
  });

  return fileRouter;
};
