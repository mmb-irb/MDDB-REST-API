require('dotenv').config();

const server = require('./src/server');
// const dbConnectionPromise = require('./src/models');

const main = async () => {
  let serverInstance;
  let dbConnection;
  try {
    dbConnection = await dbConnection;
    serverInstance = server.start();
  } catch (error) {
    console.error(error);
    if (serverInstance) server.stop();
  } finally {
    if (dbConnection && 'close' in dbConnection) dbConnection.close();
  }
};

main();
