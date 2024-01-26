const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Functions to retrieve project data and get a given file id
const { getProjectData } = require('../../../utils/get-project-data');

const analysisRouter = Router({ mergeParams: true });

module.exports = (_, { projects, analyses }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Get the requested project data
        const projectData = await getProjectData(projects, request);
        // If there was any problem then return the errors
        if (projectData.error) return projectData;
        // Return analysis names only
        return projectData.analyses;
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
        // Get the requested project data
        const projectData = await getProjectData(projects, request);
        // If there was any problem then return the errors
        if (projectData.error) return projectData;
        // Query the database and retrieve the requested analysis
        const analysisData = await analyses.findOne(
          // Set the query
          {
            project: projectData.internalId,
            md: projectData.mdIndex,
            name: request.params.analysis.toLowerCase(),
          },
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
