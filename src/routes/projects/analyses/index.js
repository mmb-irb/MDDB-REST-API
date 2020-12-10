const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../../utils/published-filter');
// Adds the project associated ID from mongo db to the provided object
const augmentFilterWithIDOrAccession = require('../../../utils/augment-filter-with-id-or-accession');

const analysisRouter = Router({ mergeParams: true });

module.exports = (_, { projects, analyses }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      retriever(request) {
        // Return the project which matches the request accession
        return projects.findOne(
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
          // But return only the "analyses" attribute
          { projection: { _id: false, analyses: true } },
        );
      },
      // If there is nothing retrieved or the retrieved has no analyses, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!(retrieved && retrieved.analyses)) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has analyses, send the analyses in the body
      body(response, retrieved) {
        if (retrieved && retrieved.analyses) response.json(retrieved.analyses);
        else response.end();
      },
    }),
  );

  // When there is an analysis parameter (e.g. .../analyses/rmsd)
  analysisRouter.route('/:analysis').get(
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
        // Else, find the analysis with the provided name in the project
        return analyses.findOne(
          {
            project: projectDoc._id,
            name: request.params.analysis.toLowerCase(),
          },
          // But do not return the _id and project attributes
          { projection: { _id: false, name: false, project: false } },
        );
      },
      // If there is nothing retrieved or the retrieved has no value, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!(retrieved && retrieved.value)) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has a value, send the analyses in the body
      body(response, retrieved) {
        if (retrieved && retrieved.value) {
          // Send the response in json format
          // The 'value' must be an object
          response.json(retrieved.value);
        } else response.end();
      },
    }),
  );

  return analysisRouter;
};
