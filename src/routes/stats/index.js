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
            // Create a formatted response with values in TB
            const storageStats = {
                // databaseName: dbStats.db,
                dataSizeInTB: +(dbStats.dataSize / 1e6).toFixed(2),
                storageUsedInTB: +(dbStats.storageSize / 1e6).toFixed(2),
                indexSizeInMB: +(dbStats.indexSize).toFixed(2),
                usedDiskInTB: +(dbStats.fsUsedSize / 1e6).toFixed(2),
                availableDiskInTB: +(dbStats.fsTotalSize / 1e6).toFixed(2),
                nShards: Object.keys(dbStats.raw).length,
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