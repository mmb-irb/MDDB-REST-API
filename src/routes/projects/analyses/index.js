const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
const publishedFilter = require('../../../utils/published-filter');
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');

const analysisRouter = Router({ mergeParams: true });

module.exports = (_, { projects, analyses }) => {
  // root
  analysisRouter.route('/').get(
    handler({
      retriever(request) {
        return projects.findOne(
          // filter
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // options
          { projection: { _id: false, analyses: true } },
        );
      },
      headers(response, retrieved) {
        if (!(retrieved && retrieved.analyses)) response.sendStatus(NOT_FOUND);
      },
      body(response, retrieved) {
        if (retrieved && retrieved.analyses) response.json(retrieved.analyses);
      },
    }),
  );

  // analysis
  analysisRouter.route('/:analysis').get(
    handler({
      async retriever(request) {
        const projectDoc = await projects.findOne(
          // filter
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // options
          { projection: { _id: true } },
        );
        if (!projectDoc) return;
        return analyses.findOne(
          // filter
          {
            project: projectDoc._id,
            name: request.params.analysis.toLowerCase(),
          },
          // options
          { projection: { _id: false, project: false } },
        );
      },
      headers(response, retrieved) {
        if (!(retrieved && retrieved.value)) response.sendStatus(NOT_FOUND);
      },
      body(response, retrieved) {
        if (!(retrieved && retrieved.value)) return;
        const { value, ...data } = retrieved;
        response.json({ ...data, ...value });
      },
    }),
  );

  return analysisRouter;
};
