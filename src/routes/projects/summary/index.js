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
              'metadata.SEQUENCES': false,
              'metadata.DOMAINS': false,
            },
          },
        );
        // Consume the cursor
        const data = await cursor.toArray();
        // Set the summary object to be returned
        // Then all mined data will be written into it
        const summary = {};
        // Get the number of projects
        summary['projectsCount'] = data.length;
        // Count the number of MDs
        let mdCount = 0;
        data.forEach(project => {
          // If it is the old format then it only counts as 1 MD
          if (!project.mds) return mdCount += 1;
          // Otherwise, count the number of MDs
          mdCount += project.mds.length;
        });
        summary['mdCount'] = mdCount;
        // Get the total MD time
        const totalTime = data
          .map(project => {
            const metadata = project.metadata;
            if (!metadata) return 0;
            const length = +metadata.LENGTH;
            const mds = project.mds;
            if (!mds) return length;
            // DANI: Esto no es del todo preciso, pues podrían haber réplicas con menos frames (e.g. las moonshot)
            // DANI: Esto se solucionará al reemplazar el campo de LENGTH for el de FRAMESTEP
            return length * mds.length;
          })
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalTime'] = totalTime;
        // Get the total MD number of frames
        const totalFrames = data
          .map(project => {
            const metadata = project.metadata;
            if (!metadata) return 0;
            const mds = project.mds;
            if (!mds) return +metadata.SNAPSHOTS;
            return mds.reduce((acc, curr) => (acc + curr.frames), 0);
          })
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalFrames'] = totalFrames;
        // Get the total number of files
        const totalFiles = data
          .map(project => {
            const mds = project.mds;
            if (!mds) {
              const files = project.files;
              if (!files) return 0;
              return files.length;
            }
            return mds.reduce((acc, curr) => (acc + curr.files.length), 0);
          })
          .reduce((acc, curr) => {
            if (curr) {
              return acc + curr;
            } else return acc;
          }, 0);
        summary['totalFiles'] = totalFiles;
        // Get the total number of analyses
        const totalAnalyses = data
          .map(project => {
            const mds = project.mds;
            if (!mds) {
              const analyses = project.analyses;
              if (!analyses) return 0;
              return analyses.length;
            }
            return mds.reduce((acc, curr) => (acc + curr.analyses.length), 0);
          })
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
