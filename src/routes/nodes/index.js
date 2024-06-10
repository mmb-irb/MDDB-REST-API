const router = require('express').Router();
// A standard request and response handler used widely in most endpoints
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Standard HTTP response status codes
const { BAD_REQUEST } = require('../../utils/status-codes');

// Get nodes info such as their name, API URL or phisical location
const getNodesInfo = async request => {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Make sure the nodes collection exists
    if (!database.nodes) return {
        headerError: BAD_REQUEST,
        error: `Missing nodes collection. Note that the 'nodes' endpoint is only available in the global API`
    }
    // Get all nodes in the global nodes database and remove internal ids
    const nodesData = await database.nodes.find(
        {}, { projection: { _id: false } }
    ).toArray();
    return nodesData;
};

// Set the routing
// Get nodes info such as their name, API URL or phisical location
// DANI: Esto lo monté así porque originalmente tenía pensado 2 endpoints: nodes/info y nodes/status
// DANI: Ambos endpoints habrían usado la función getNodesInfo, pero al final decidí no hacer el status
router.route('/').get(handler({
    async retriever(request) {
        return await getNodesInfo(request);
    }
}));
module.exports = router;