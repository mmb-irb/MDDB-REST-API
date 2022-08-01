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
    REFERENCES: ['SARS-CoV-2 spike', 'Angiotensin-converting enzyme 2'],
  },
};

const project2 = require('./project.json');

const reference1 = {
  name: 'SARS-CoV-2 spike',
  sequence: 'ABCDEFG',
};

const reference2 = {
  name: 'Angiotensin-converting enzyme 2',
  sequence: 'WTFRUTA',
};

// Set up the fake server and return an available connection to this server
const establishFakeConnection = async () => {
  let client;
  try {
    // Create the server with a stablished port and dbname, so the connection string is always the same
    const mongod = await MongoMemoryServer.create({
      instance: { port: +process.env.DB_PORT, dbName: process.env.DB_NAME },
    });
    const connectionString = await mongod.getUri();
    client = await mongodb.MongoClient.connect(connectionString, {
      useUnifiedTopology: true,
    });
    //console.log(mongod.getInstanceInfo());
    // Add data to the server to simulate the MoDEL structure
    const db = client.db(process.env.DB_NAME);
    const projects = await db.createCollection('projects');
    await projects.insertOne(project1);
    await projects.insertOne(project2);
    const references = await db.createCollection('references');
    await references.insertOne(reference1);
    await references.insertOne(reference2);
    await db.createCollection('topologies');
    return client;
  } catch (error) {
    console.error('fake mongodb connection error');
    console.error(error);
    if (client && 'close' in client) client.close();
  }
};

module.exports = establishFakeConnection();
