const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const { getProjectQuery } = require('../../../utils/get-project-query');

const analysisRouter = Router({ mergeParams: true });

module.exports = (_, { projects, analyses }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      retriever(request) {
        // Return the project which matches the request accession
        return projects.findOne(
          getProjectQuery(request),
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
          getProjectQuery(request),
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
