// Allows playing with the console output
const tracker = require('./src/utils/debug-logs');
// Load enviornmental variables defined in the .env file
const dotenvLoad = require('dotenv').config();
if (dotenvLoad.error) throw dotenvLoad.error;

const server = require('./src/server');
// const dbConnectionPromise = require('./src/models');

// Set if the API was run in debug mode
const isDebug = (process.env.DEBUG && process.env.DEBUG.toUpperCase() === 'TRUE') || false;

const main = async () => {
  let serverInstance;
  // let dbConnection;
  try {
    // dbConnection = await dbConnectionPromise;
    serverInstance = server.start();
    // Get console feedback of each API connection and request
    if (isDebug) tracker(serverInstance);
  } catch (error) {
    console.error(error);
    if (serverInstance) server.stop();
  } finally {
    // if (dbConnection && 'close' in dbConnection) dbConnection.close();
  }
};

main();
