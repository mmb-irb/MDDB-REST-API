const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../../utils/published-filter');

const analysisRouter = Router({ mergeParams: true });

// This endpoint returns some summary of data contained in the projects collection
module.exports = (_, { projects }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever() {
        // Get all projects
        const cursor = await projects.find(
          publishedFilter,
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
          .map(object => +object.metadata.LENGTH)
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalTime'] = totalTime;
        // Get the total number of frames
        const totalFrames = data
          .map(object => +object.metadata.SNAPSHOTS)
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
        // Get the percent of each 'unit' in all simulations
        const units = data.map(object => object.metadata.UNIT);
        const unitPercents = {};
        units.forEach(
          unit => (unitPercents[unit] = (unitPercents[unit] || 0) + 1),
        );
        summary['unitPercents'] = unitPercents;
        // Send all mined data
        return summary;
      },
      // If there is nothing retrieved send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(INTERNAL_SERVER_ERROR);
      },
      // If there is retrieved and the retrieved has metadata then send the inputs file
      body(response, retrieved) {
        if (!retrieved) response.end();
        response.json(retrieved);
      },
    }),
  );

  return analysisRouter;
};
