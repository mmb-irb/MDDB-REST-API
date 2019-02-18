const MongoMemoryServer = require('mongodb-memory-server');

const establishConnection = require('../../models');

const getServer = async () => {
  const mongod = new MongoMemoryServer();
  const connectionString = await mongod.getConnectionString();
  const client = establishConnection(connectionString);
  return {
    destroy() {
      client.close();
      mongod.stop();
    },
  };
};

module.exports = getServer;
