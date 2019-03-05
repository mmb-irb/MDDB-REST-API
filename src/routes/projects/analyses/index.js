const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');

const analysisRouter = Router();

module.exports = (_, { projects, analyses }) => {
  // root
  const rootRetriever = (_, { project }) =>
    projects.findOne(
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
    response.json(data.analyses || []);
  };

  // analysis
  const analysisRetriever = (request, { project }) =>
    analyses.findOne(
      { project, name: request.params.analysis.toLowerCase() },
      {
        projection: {
          _id: false,
        },
      },
    );

  const analysisSerializer = (response, data) => {
    if (!(data && data.value)) {
      return response.sendStatus(NOT_FOUND);
    }
    const { value, ..._data } = data;
    response.json({ ..._data, ...value });
  };

  // handlers
  analysisRouter.route('/').get(handler(rootRetriever, rootSerializer));

  analysisRouter
    .route('/:analysis')
    .get(handler(analysisRetriever, analysisSerializer));

  return analysisRouter;
};
