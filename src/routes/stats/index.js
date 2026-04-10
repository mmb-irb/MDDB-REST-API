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

// In-memory cache for the GridFS size aggregation (expensive full-collection scan)
const CACHE_TTL_MS = 60 * 60 * 1000 * 24; // 24 hour
let gridFsSizeCache = new Map();

// Root -> display available PDBs
router.route('/').get(
    handler({
        async retriever(request) {
            // Find out if the request host is configured as global
            const config = getConfig(request);
            const isGlobal = config && config.global;
            // Global stats may not be asked to the global API
            if (isGlobal) return {
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
            const query = request.query.query;
            let realDataSizeInTB;
            if (!query) {
                realDataSizeInTB = +(dbStats.dataSize / 1e6);
            } else {
                // This is expensive so we cache it with a TTL, keyed by query string
                if (!gridFsSizeCache.has(query) 
                    || Date.now() - gridFsSizeCache.get(query).timestamp > CACHE_TTL_MS) {
                    const projectsFinder = database.getBaseFilter();
                    const processedQuery = await database.processProjectsQuery(query);
                    if (processedQuery.error) return processedQuery;
                    if (!projectsFinder.$and) projectsFinder.$and = processedQuery;
                    else projectsFinder.$and = projectsFinder.$and.concat(processedQuery);
                    // Get all file IDs, including those in MDs
                    const projectsCursor = await database.projects.find(
                        projectsFinder,
                        { projection: { files: 1, 'mds.files': 1 } },
                    );
                    const allProjects = await projectsCursor.toArray();
                    // Flatten all file IDs
                    const fileIds = allProjects.flatMap(project => [
                        ...(project.files ?? []).map(f => f.id),
                        ...(project.mds   ?? []).flatMap(md => (md.files ?? []).map(f => f.id)),
                    ]);
                    // Sum 'length' from fs.files for all those IDs
                    const sizeAgg = await database.db.collection('fs.files').aggregate([
                        { $match: { _id: { $in: fileIds } } },
                        { $group: { _id: null, totalBytes: { $sum: '$length' } } },
                    ]).toArray();
                    const totalBytes = sizeAgg.length > 0 ? sizeAgg[0].totalBytes : 0;
                    gridFsSizeCache.set(query, { totalBytes, timestamp: Date.now() });
                }
                realDataSizeInTB = +(gridFsSizeCache.get(query).totalBytes / 1e12);
            }
            // Create a formatted response with values in TB
            const storageStats = {
                // databaseName: dbStats.db,
                dataSizeInTB: +(dbStats.dataSize / 1e6).toFixed(2),
                realDataSizeInTB, // Decimals are not fixed because we may have to change the unit (TB vs GB) depending on the value
                storageUsedInTB: +(dbStats.storageSize / 1e6).toFixed(2),
                indexSizeInMB: +(dbStats.indexSize).toFixed(2),
                usedDiskInTB: +(dbStats.fsUsedSize / 1e6).toFixed(2),
                availableDiskInTB: +(dbStats.fsTotalSize / 1e6).toFixed(2),
                nShards: dbStats.raw ? Object.keys(dbStats.raw).length : 1,
                // objectCount: dbStats.objects,
                // collections: dbStats.collections,
                // indexes: dbStats.indexes
            };

            // Send all mined data
            return storageStats;
        }
    }),
);

module.exports = router;