// This library provides a fake mongo db which is useful to perform tests
// More information: https://github.com/nodkz/mongodb-memory-server
const mongodb = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Set some fake projects to be uploaded
const project1 = {
  accession: 'PRUEBA01',
  published: false,
  metadata: {
    NAME: 'prueba 1',
    UNIT: 'A',
    ATOMS: 123,
    TOPOREFS: [{ name: 'Spike' }, { name: 'ACE2' }],
  },
};

const project2 = require('./project.json');

const toporef1 = {
  name: 'Spike',
  sequence: 'ABCDEFG',
};

const toporef2 = {
  name: 'ACE2',
  sequence: 'WTFRUTA',
};

// Set up the fake server and return an available connection to this server
const establishFakeConnection = async () => {
  let client;
  try {
    // Create the server with a stablished port and dbname, so the connection string is always the same
    const mongod = new MongoMemoryServer({
      instance: { port: 38279, dbName: 'f97aa129-34f0-441b-bbe3-7d9e3750bea0' },
    });
    const connectionString = await mongod.getConnectionString();
    client = await mongodb.MongoClient.connect(connectionString, {
      useUnifiedTopology: true,
    });
    //console.log(mongod.getInstanceInfo());
    // Add data to the server to simulate the MoDEL structure
    const db = client.db(process.env.DB_NAME);
    const projects = await db.createCollection('projects');
    await projects.insertOne(project1);
    await projects.insertOne(project2);
    const toporefs = await db.createCollection('toporefs');
    await toporefs.insertOne(toporef1);
    await toporefs.insertOne(toporef2);
    return client;
  } catch (error) {
    console.error('fake mongodb connection error');
    console.error(error);
    if (client && 'close' in client) client.close();
  }
};

module.exports = establishFakeConnection();
