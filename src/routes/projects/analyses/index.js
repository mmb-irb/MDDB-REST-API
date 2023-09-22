const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const {
  getProjectQuery,
  getMdIndex,
} = require('../../../utils/get-project-query');

const analysisRouter = Router({ mergeParams: true });

module.exports = (_, { projects, analyses }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Return the project which matches the request accession
        const projectData = await projects.findOne(
          getProjectQuery(request),
          // But return only the "analyses" attribute
          { projection: { _id: false, analyses: true, mds: true } },
        );
        // If we did not find it then there is nothing to do here
        if (!projectData) return;
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = getMdIndex(request);
        // If the project has not the 'mds' field then it means it has the old format
        // Return its analyses, as before
        if (!projectData.mds) {
          // Make sure no md was requested or raise an error to avoid silent problems
          // User may think each md returns different data otherwise
          if (requestedMdIndex !== null)
            return {
              error:
                'This project has no MDs. Please use the accession or id alone.',
            };
          return projectData.analyses;
        }
        // Get the MD index, which is the requested index or, if none, the reference index
        const mdIndex =
          requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
        // Get the corresponding MD data and return its analysis names
        const mdData = projectData.mds[mdIndex];
        return mdData.analyses.map(analysis => analysis.name);
      },
      // If there is nothing retrieved or the retrieved has no analyses, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has analyses, send the analyses in the body
      body(response, retrieved) {
        if (retrieved) response.json(retrieved);
        else response.end();
      },
    }),
  );

  // When there is an analysis parameter (e.g. .../analyses/rmsd)
  analysisRouter.route('/:analysis').get(
    handler({
      async retriever(request) {
        // Find the project which matches the request accession
        const projectData = await projects.findOne(
          getProjectQuery(request),
          // Get only the id and the reference md index
          { projection: { _id: true, mdref: true } },
        );
        // If there is no project we return here
        if (!projectData) return;
        // Now set the analysis query from the project id and the analysis name
        const query = {
          project: projectData._id,
          name: request.params.analysis.toLowerCase(),
        };
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = getMdIndex(request);
        // If the project has not the 'mdref' field then it means it has the old format
        // In this case there is no need to add the md index to the query
        // Othewise, add the md index to the query
        if ('mdref' in projectData) {
          // Get the MD index, which is the requested index or, if none, the reference index
          const mdIndex =
            requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
          query.md = mdIndex;
        }
        // If this is the old format then make sure no md was requested or raise an error to avoid silent problems
        // User may think each md returns different data otherwise
        else {
          if (requestedMdIndex !== null)
            return {
              error:
                'This project has no MDs. Please use the accession or id alone.',
            };
        }
        // Query the database and retrieve the requested analysis
        const analysisData = await analyses.findOne(
          query,
          // Skip some useless values
          { projection: { _id: false, name: false, project: false } },
        );
        // If we did not found the analysis then there is nothing to do
        if (!analysisData) return;
        // Send the analysis data
        return analysisData.value;
      },
      // If there is nothing retrieved or the retrieved has no value, send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved has a value, send the analyses in the body
      body(response, retrieved) {
        if (retrieved) {
          // Send the response in json format
          // The 'value' must be an object
          response.json(retrieved);
        } else response.end();
      },
    }),
  );

  return analysisRouter;
};
