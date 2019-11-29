// This library provides a fake mongo db which is useful to perform tests
// More information: https://github.com/nodkz/mongodb-memory-server
const mongodb = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const getServer = async () => {
  const mongod = new MongoMemoryServer();
  const connectionString = await mongod.getConnectionString();
  const client = await mongodb.MongoClient.connect(connectionString);
  const status = mongod.getInstanceInfo();
  return {
    status,
    /*
    status() {
      mongod.getInstanceInfo();
    },
    /*
    destroy() {
      client.close();
      mongod.stop();
    },
    */
  };
};

module.exports = getServer;
