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
  },
};
const project2 = {
  accession: 'PRUEBA02',
  published: true,
  metadata: {
    NAME: 'prueba 2',
    UNIT: 'A',
  },
};
const project3 = {
  accession: 'PRUEBA03',
  published: false,
  metadata: {
    NAME: 'prueba 3',
    UNIT: 'B',
  },
};

// Set up the fake server and return an available connection to this server
const establishFakeConnection = async () => {
  let client;
  try {
    // Create the server
    const mongod = new MongoMemoryServer();
    const connectionString = await mongod.getConnectionString();
    client = await mongodb.MongoClient.connect(connectionString);
    //console.log(mongod.getInstanceInfo());
    // Add data to the server to simulate the MoDEL structure
    const db = client.db(process.env.DB_NAME);
    const projects = await db.createCollection('projects');
    //console.log(projects);
    await projects.insertOne(project1);
    await projects.insertOne(project2);
    await projects.insertOne(project3);
    return client;
  } catch (error) {
    console.error('fake mongodb connection error');
    console.error(error);
    if (client && 'close' in client) client.close();
  }
};

module.exports = establishFakeConnection();
