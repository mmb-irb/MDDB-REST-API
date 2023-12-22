const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND, BAD_REQUEST } = require('../../../utils/status-codes');
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
          { projection: { _id: false, analyses: true, mds: true, mdref: true } },
        );
        // If we did not find it then there is nothing to do here
        if (!projectData) return;
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = getMdIndex(request);
        // If something went wrong with the MD request then return the error
        if (requestedMdIndex instanceof Error) return {
          headerError: BAD_REQUEST,
          error: requestedMdIndex.message
        };
        // If the project has not the 'mds' field then it means it has the old format
        if (!projectData.mds) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'Project is missing mds. Is it in an old format?'
        };
        // Get the MD index, which is the requested index or, if none, the reference index
        const mdIndex = requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
        // Get the corresponding MD data
        const mdData = projectData.mds[mdIndex];
        // If the corresponding index does not exist then return an error
        if (!mdData) return {
          headerError: NOT_FOUND,
          error: 'The requested MD does not exists. Try with numbers 1-' + projectData.mds.length
        };
        // Return only a list with the analysis names
        const projectAnalyses = projectData.analyses || [];
        const mdAnalyses = mdData.analyses || [];
        return projectAnalyses.concat(mdAnalyses).map(analysis => analysis.name);
      },
      // Handle the response header
      headers(response, retrieved) {
        // If nothing is retrieved then send a NOT_FOUND header and end the response
        if (!retrieved) return response.sendStatus(NOT_FOUND);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
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
          { projection: { _id: true, mds: true, mdref: true } },
        );
        // If there is no project we return here
        if (!projectData) return;
        // Now set the analysis query from the project id and the analysis name
        // Note that the MD index is added further
        const query = {
          project: projectData._id,
          name: request.params.analysis.toLowerCase(),
        };
        // Get the md index from the request or use the reference MD id in case it is missing
        const requestedMdIndex = getMdIndex(request);
        // If something went wrong with the MD request then return the error
        if (requestedMdIndex instanceof Error) return {
          headerError: BAD_REQUEST,
          error: requestedMdIndex.message
        };
        // If the project has not the 'mdref' field then it means it has the old format
        if (!'mdref' in projectData ) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: 'Project is missing mds. Is it in an old format?'
        };
        // Add the md index to the query
        // Get the MD index, which is the requested index or, if none, the reference index
        const mdIndex = requestedMdIndex !== null ? requestedMdIndex : projectData.mdref;
        // Check the mdIndex to be in range of the available MDs
        if (mdIndex >= projectData.mds.length) return {
          headerError: NOT_FOUND,
          error: 'The requested MD does not exists. Try with numbers 1-' + projectData.mds.length
        };
        // Add the MD index to the query
        query.md = mdIndex;
        // Query the database and retrieve the requested analysis
        const analysisData = await analyses.findOne(
          query,
          // Skip some useless values
          { projection: { _id: false, name: false, project: false, md: false } },
        );
        // If we did not found the analysis then there is nothing to do
        if (!analysisData) return;
        // Send the analysis data
        return analysisData.value;
      },
      // Handle the response header
      headers(response, retrieved) {
        // If nothing is retrieved then send a NOT_FOUND header and end the response
        if (!retrieved) return response.sendStatus(NOT_FOUND);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
      },
    }),
  );

  return analysisRouter;
};
