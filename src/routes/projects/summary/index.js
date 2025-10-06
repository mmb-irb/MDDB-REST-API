const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');

const router = Router({ mergeParams: true });

// Endpoint to get project growth timeline data
router.route('/growth').get(
  handler({
    async retriever(request) {
      // Establish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Set the base filter
      const finder = database.getBaseFilter();
      
      // Get all projects with creation dates and MD counts
      const cursor = await database.projects.find(
        finder,
        {
          projection: {_id: 1, mds: 1 },
        },
      );
      
      // Consume the cursor
      const projects = await cursor.toArray();
      // Group projects by month with MD counts
      const monthlyData = {};
      
      projects.forEach(project => {
        const date = project._id.getTimestamp();
        const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData[yearMonth]) {
          monthlyData[yearMonth] = { projects: 0, mds: 0 };
        }
        
        monthlyData[yearMonth].projects++;
        
        // Count MDs for this project
        if (project.mds) {
          monthlyData[yearMonth].mds += project.mds.length;
        } else {
          // If using old format, count as 1 MD
          monthlyData[yearMonth].mds += 1;
        }
      });
      
      // Convert to array and sort chronologically
      const sortedMonths = Object.keys(monthlyData).sort();
      
      // Calculate cumulative growth for both projects and MDs
      let cumulativeProjects = 0;
      let cumulativeMds = 0;
      
      const growthData = sortedMonths.map(month => {
        cumulativeProjects += monthlyData[month].projects;
        cumulativeMds += monthlyData[month].mds;
        
        return {
          date: month,
          newProjects: monthlyData[month].projects,
          totalProjects: cumulativeProjects,
          newMds: monthlyData[month].mds,
          totalMds: cumulativeMds
        };
      });
      
      return growthData;
    }
  }),
);

// This endpoint returns some summary of data contained in the projects collection
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Set an object with all the parameters to performe the mongo query
      // Start filtering by published projects only if we are in production environment
      const finder = database.getBaseFilter();
      // Handle when there is a mongo query
      let query = request.query.query;
      if (query) {
        // Process the mongo query to convert references and topology queries
        const processedQuery = await database.processProjectsQuery(query);
        if (processedQuery.error) return processedQuery;
        if (!finder.$and) finder.$and = processedQuery;
        else finder.$and = finder.$and.concat(processedQuery);
      }
      // Get all projects
      const cursor = await database.projects.find(
        finder,
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
          // Calculate the time based in the framestep and the number of frames of each MD
          if (metadata.FRAMESTEP) return mds.reduce((acc, curr) => acc + curr.frames * metadata.FRAMESTEP, 0);
          // If we are missing the framestep then use the length, but here we assume some error
          // DANI: Esto no es preciso, pues podrían haber réplicas con menos frames (e.g. las moonshot)
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
          return mds.reduce((acc, curr) => (acc + curr.files ? curr.files.length : 0), 0);
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
          return mds.reduce((acc, curr) => (acc + curr.analyses ? curr.analyses.length : 0), 0);
        })
        .reduce((acc, curr) => {
          if (curr) {
            return acc + curr;
          } else return acc;
        }, 0);
      summary['totalAnalyses'] = totalAnalyses;

      // Get database statistics
      const dbStats = await database.db.command({ dbStats: 1, scale: 1000}); // Results in MB
      // Create a formatted response with values in TB
      const storageStats = {
        // databaseName: dbStats.db,
        dataSizeInTB: +(dbStats.dataSize / 1e9).toFixed(2),
        storageUsedInTB: +(dbStats.storageSize / 1e9).toFixed(2),
        indexSizeInTB: +(dbStats.indexSize / 1e9).toFixed(2),
        totalSizeInTB: +((dbStats.storageSize + dbStats.indexSize) / 1e9).toFixed(2),
        // objectCount: dbStats.objects,
        // collections: dbStats.collections,
        // indexes: dbStats.indexes
      };
      summary['storageStats'] = storageStats;

      // Send all mined data
      return summary;
    }
  }),
);

module.exports = router;