const Router = require('express').Router;
const mongodb = require('mongodb');

const handler = require('../../../utils/generic-handler');

const analysisRouter = Router();

const NOT_FOUND = 404;

module.exports = (db, model) => {
  // root
  const rootRetriever = (_, { project }) =>
    model.findOne(
      { _id: project },
      {
        projection: {
          _id: false,
          analyses: true,
        },
      },
    );

  const rootSerializer = (response, data) => {
    if (!(data && data.analyses)) {
      return response.sendStatus(NOT_FOUND);
    }
    response.json(data.analyses);
  };

  // analysis
  const analysisRetriever = (request, { project }) =>
    model.findOne(
      { _id: project },
      {
        projection: {
          _id: false,
          [`analyses.${request.params.analysis}`]: true,
        },
      },
    );

  const analysisSerializer = (response, data, { analysis }) => {
    if (!(data && data.analyses && data.analyses[analysis])) {
      return response.sendStatus(NOT_FOUND);
    }
    response.json(data.analyses[analysis]);
  };

  // handlers
  analysisRouter.route('/').get(handler(rootRetriever, rootSerializer));

  analysisRouter
    .route('/:analysis')
    .get(handler(analysisRetriever, analysisSerializer));

  return analysisRouter;
};
