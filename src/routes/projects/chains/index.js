const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
const publishedFilter = require('../../../utils/published-filter');
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');

const chainRouter = Router();

module.exports = (_, { projects, chains }) => {
  // root
  const rootRetriever = (_, { project }) =>
    projects.findOne(
      // filter
      augmentFilterWithIDOrAccession(publishedFilter, project),
      // options
      { projection: { _id: false, chains: true } },
    );

  const rootSerializer = (response, data) => {
    if (!(data && data.chains)) {
      return response.sendStatus(NOT_FOUND);
    }
    response.json(data.chains);
  };

  // chain
  const chainRetriever = async (request, { project }) => {
    const projectDoc = await projects.findOne(
      // filter
      augmentFilterWithIDOrAccession(publishedFilter, project),
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
  };

  const chainSerializer = (response, data) => {
    if (!(data && data.sequence)) {
      return response.sendStatus(NOT_FOUND);
    }
    const { value, ..._data } = data;
    response.json({ ..._data, ...value });
  };

  // handlers
  chainRouter.route('/').get(handler(rootRetriever, rootSerializer));

  chainRouter.route('/:chain').get(handler(chainRetriever, chainSerializer));

  return chainRouter;
};
