const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../../utils/published-filter');
// Adds the project associated ID from mongo db to the provided object
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');

const chainRouter = Router({ mergeParams: true });

module.exports = (_, { projects, chains }) => {
  // Root
  chainRouter.route('/').get(
    handler({
      retriever(request) {
        // Return the project which matches the request accession
        return projects.findOne(
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // But return only the "chains" attribute
          { projection: { _id: false, chains: true } },
        );
      },
      // If there is nothing retrieved or the retrieved has no chains, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!(retrieved && retrieved.chains)) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has chains, send the chains in the body
      body(response, retrieved) {
        if (retrieved && retrieved.chains) response.json(retrieved);
      },
    }),
  );

  // When there is a chain parameter (e.g. .../chains/A)
  chainRouter.route('/:chain').get(
    handler({
      async retriever(request) {
        // Find the project which matches the request accession
        const projectDoc = await projects.findOne(
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // And get the "_id" attribute
          { projection: { _id: true } },
        );
        // If there is no project we return here
        if (!projectDoc) return;
        // Else, find the chain with the provided name in the project
        return chains.findOne(
          { project: projectDoc._id, name: request.params.chain },
          // But do not return the _id and project attributes
          { projection: { _id: false, project: false } },
        );
      },
      // If there is nothing retrieved or the retrieved has no sequence, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!(retrieved && retrieved.sequence)) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has a sequece, send the analyses in the body
      body(response, retrieved) {
        if (retrieved && retrieved.sequence) {
          response.json(retrieved);
        }
      },
    }),
  );

  return chainRouter;
};
