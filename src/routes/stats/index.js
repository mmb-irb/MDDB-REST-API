const Router = require('express').Router;
// Get the database handler
const getDatabase = require('../../database');
// A standard request and response handler used widely in most endpoints
const handler = require('../../utils/generic-handler');
// Import auxiliar functions
const { getConfig } = require('../../utils/auxiliar-functions');
// Standard HTTP response status codes
const { BAD_REQUEST } = require('../../utils/status-codes');

const router = Router({ mergeParams: true });

router.route('/').get(
    handler({
        async retriever(request) {
            // Find out if the request host is configured as global
            const config = getConfig(request);
            const isGlobal = config && config.global;
            // Global stats may not be asked to the global API
            const query = request.query.query;
            if (isGlobal && !query) return {
                headerError: BAD_REQUEST,
                error: 'This is the global database and its stats may be missleading.'
                    + ' In order to get the global stats all federated nodes must be asked.'
            }
            // Stablish database connection and retrieve our custom handler
            const database = await getDatabase(request);
            // Get database statistics
            const dbStats = await database.db.command({ dbStats: 1, scale: 1e6}); // Results in KB
            // Compute the real stored size of GridFS files for the queried projects
            // Without a query filter this would require aggregating all files in the DB,
            // so we skip it and fall back to the dbStats figure instead
            let storageStats;
            if (!query) {
                // Use the dbStats figures directly, which are already pre-calculated by MongoDB
                storageStats = {
                    totalSize: dbStats.dataSize * 1e6, // Convert back to bytes
                    // databaseName: dbStats.db,
                    dataSizeInTB: +(dbStats.dataSize / 1e6).toFixed(2),
                    storageUsedInTB: +(dbStats.storageSize / 1e6).toFixed(2),
                    indexSizeInMB: +(dbStats.indexSize).toFixed(2),
                    usedDiskInTB: +(dbStats.fsUsedSize / 1e6).toFixed(2),
                    availableDiskInTB: +(dbStats.fsTotalSize / 1e6).toFixed(2),
                    nShards: dbStats.raw ? Object.keys(dbStats.raw).length : 1,
                    // objectCount: dbStats.objects,
                    // collections: dbStats.collections,
                    // indexes: dbStats.indexes
                };
            } else {
                // Use the pre-calculated totalSize stored in project documents
                // This avoids the expensive full-collection aggregation query
                const projectsFinder = database.getBaseFilter();
                const processedQuery = await database.processProjectsQuery(query);
                if (processedQuery.error) return processedQuery;
                if (!projectsFinder.$and) projectsFinder.$and = processedQuery;
                else projectsFinder.$and = projectsFinder.$and.concat(processedQuery);
                
                // Sum the totalSize field from all matching projects
                const sizeAgg = await database.projects.aggregate([
                    { $match: projectsFinder },
                    { $group: { _id: null, totalSize: { $sum: '$totalSize' } } }
                ]).toArray();
                
                const totalSize = sizeAgg.length > 0 ? sizeAgg[0].totalSize : 0;
                const dataSizeInTB = +(totalSize / 1e12).toFixed(2);
                storageStats = {
                    totalSize,
                    dataSizeInTB,
                    // For backwards compatibility. Remove when all the client>0.0.14
                    realDataSizeInTB: dataSizeInTB, 
                };
            }
            // Send all mined data
            return storageStats;
        }
    }),
);

module.exports = router;