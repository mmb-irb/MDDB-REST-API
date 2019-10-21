const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
const publishedFilter = require('../../../utils/published-filter');
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');

const chainRouter = Router({ mergeParams: true });

module.exports = (_, { projects, chains }) => {
  // root
  chainRouter.route('/').get(
    handler({
      retriever(request) {
        return projects.findOne(
          // filter
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // options
          { projection: { _id: false, chains: true } },
        );
      },
      headers(response, retrieved) {
        if (!(retrieved && retrieved.chains)) response.sendStatus(NOT_FOUND);
      },
      body(response, retrieved) {
        if (retrieved && retrieved.chains) response.json(retrieved);
      },
    }),
  );

  // chain
  chainRouter.route('/:chain').get(
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
        return chains.findOne(
          // filter
          { project: projectDoc._id, name: request.params.chain },
          // options
          { projection: { _id: false, project: false } },
        );
      },
      headers(response, retrieved) {
        if (!(retrieved && retrieved.sequence)) response.sendStatus(NOT_FOUND);
      },
      body(response, retrieved) {
        if (!(retrieved && retrieved.sequence)) return;
        const { value, ...data } = retrieved;
        response.json({ ...data, ...value });
      },
    }),
  );

  return chainRouter;
};
