const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const { getBaseFilter } = require('../../../utils/get-project-query');

const analysisRouter = Router({ mergeParams: true });

// This endpoint returns some summary of data contained in the projects collection
module.exports = (_, { projects }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Get all projects
        const cursor = await projects.find(
          getBaseFilter(request),
          // Discard the heaviest fields we do not need anyway
          {
            projection: {
              id: false,
              'metadata.pdbInfo': false,
              'metadata.INTERACTIONS': false,
              'metadata.CHARGES': false,
            },
          },
        );
        // Consume the cursor
        const data = await cursor.toArray();
        // Set the summary object to be returned
        // Then all mined data will be written into it
        const summary = {};
        // Get the number of simulations
        summary['projectsCount'] = data.length;
        // Get the total simulation time
        const totalTime = data
          .map(object => object.metadata && +object.metadata.LENGTH)
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalTime'] = totalTime;
        // Get the total number of frames
        const totalFrames = data
          .map(object => object.metadata && +object.metadata.SNAPSHOTS)
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalFrames'] = totalFrames;
        // Get the total number of files
        const totalFiles = data
          .map(object => object.files && object.files.length)
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalFiles'] = totalFiles;
        // Get the total number of analyses
        const totalAnalyses = data
          .map(object => object.analyses && object.analyses.length)
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalAnalyses'] = totalAnalyses;
        // Send all mined data
        return summary;
      },
      // If there is nothing retrieved send a INTERNAL_SERVER_ERROR status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(INTERNAL_SERVER_ERROR);
      },
      // If there is retrieved and the retrieved then send it
      body(response, retrieved) {
        if (!retrieved) response.end();
        response.json(retrieved);
      },
    }),
  );

  return analysisRouter;
};
