const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');

const router = Router({ mergeParams: true });

const asNumber = field => ({ $convert: { input: field, to: 'double', onError: null, onNull: null } });
const arraySize = field => ({ $cond: [{ $isArray: field }, { $size: field }, 0] });
const sumMds = expression => ({ $sum: { $map: { input: { $ifNull: ['$mds', []] }, as: 'md', in: expression } } });
const sumMdField = field => sumMds(arraySize(`$$md.${field}`));
const sumMdNumber = field => sumMds(asNumber(`$$md.${field}`));

// Aggregate in MongoDB so the summary does not transfer every matching project
// to the API process. Precomputed values are preferred; expressions below retain
// the previous calculations for legacy projects without those fields.
const buildSummaryPipeline = finder => {
  const framestep = asNumber('$metadata.FRAMESTEP');
  const hasFramestep = { $ne: [{ $ifNull: [framestep, 0] }, 0] };
  const length = asNumber('$metadata.LENGTH');
  const isMds = { $isArray: '$mds' };
  const mdFrames = sumMdNumber('frames');
  const mdTime = sumMds({ $multiply: [asNumber('$$md.frames'), framestep] });
  const legacyMdCount = { $cond: [isMds, { $size: '$mds' }, 1] };
  const legacyTotalTime = { $cond: [isMds, { $cond: [hasFramestep, mdTime, { $multiply: [length, { $size: '$mds' }] }] }, length] };
  const legacyTotalFrames = { $cond: [isMds, mdFrames, asNumber('$metadata.SNAPSHOTS')] };
  const legacyTotalFiles = { $cond: [isMds, sumMdField('files'), arraySize('$files')] };
  const legacyTotalAnalyses = { $cond: [isMds, sumMdField('analyses'), arraySize('$analyses')] };
  return [
    { $match: finder },
    { $project: {
      mdCount: { $ifNull: [asNumber('$mdcount'), legacyMdCount] },
      totalTime: { $ifNull: [asNumber('$totalTime'), legacyTotalTime] },
      totalFrames: { $ifNull: [asNumber('$totalFrames'), legacyTotalFrames] },
      totalFiles: legacyTotalFiles,
      totalAnalyses: legacyTotalAnalyses,
    } },
    { $group: {
      _id: null,
      projectsCount: { $sum: 1 },
      mdCount: { $sum: '$mdCount' },
      totalTime: { $sum: '$totalTime' },
      totalFrames: { $sum: '$totalFrames' },
      totalFiles: { $sum: '$totalFiles' },
      totalAnalyses: { $sum: '$totalAnalyses' },
    } },
  ];
};

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
          projection: {_id: 1, creationDate: 1, mdcount: 1 },
        },
      );
      
      // Consume the cursor
      const projects = await cursor.toArray();
      // Group projects by month with MD counts
      const monthlyData = {};
      
      projects.forEach(project => {
        let date = project.creationDate || project._id.getTimestamp();
        if (typeof date === "string") date = new Date(date);
        const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData[yearMonth]) {
          monthlyData[yearMonth] = { projects: 0, mds: 0 };
        }
        
        monthlyData[yearMonth].projects++;
        
        // Count MDs for this project
        if (project.mdcount) {
          monthlyData[yearMonth].mds += project.mdcount;
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

// Endpoint to get only the fields required by the FrameStep plot
router.route('/framestep').get(
  handler({
    async retriever(request) {
      // Establish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Start filtering by published projects only if we are in production environment
      const finder = database.getBaseFilter();
      // Handle optional query filter
      const query = request.query.query;
      if (query) {
        // Process the mongo query to convert references and topology queries
        const processedQuery = await database.processProjectsQuery(query);
        if (processedQuery.error) return processedQuery;
        if (!finder.$and) finder.$and = processedQuery;
        else finder.$and = finder.$and.concat(processedQuery);
      }

      // Keep only projects that can contribute to the FrameStep scatter plot
      if (!finder.$and) finder.$and = [];
      finder.$and.push({ 'metadata.FRAMESTEP': { $gt: 0 } });
      finder.$and.push({ mds: { $exists: true, $ne: [] } });

      // Get only the minimum data required by mdposit_client data-summary/framestep
      const cursor = await database.projects.find(
        finder,
        {
          projection: {
            _id: 0,
            'metadata.FRAMESTEP': 1,
            'mds.frames': 1,
          },
        },
      );

      // Consume the cursor and return data as-is (same shape expected by the plot)
      return cursor.toArray();
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
      // Aggregate in MongoDB instead of transferring every matching project.
      const aggregationCursor = database.projects.aggregate(buildSummaryPipeline(finder));
      const [aggregatedSummary] = await aggregationCursor.toArray();
      const summaryData = aggregatedSummary || {};

      // Set the summary object to be returned.
      const summary = {};
      summary['projectsCount'] = Number(summaryData.projectsCount || 0);
      summary['mdCount'] = Number(summaryData.mdCount || 0);
      summary['totalTime'] = Number(summaryData.totalTime || 0).toFixed(2);
      summary['totalFrames'] = Number(summaryData.totalFrames || 0);
      summary['totalFiles'] = Number(summaryData.totalFiles || 0);
      summary['totalAnalyses'] = Number(summaryData.totalAnalyses || 0);

      // OBSOLETE: To get this information please use the /stats endpoint instead
      // OBSOLETE: I'll let this here for a few weeks while we update the old web clients
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
