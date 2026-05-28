// This library provides a fake mongo db which is useful to perform tests
// More information: https://github.com/nodkz/mongodb-memory-server
const mongodb = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Set some fake projects to be uploaded
const project1 = require('./project_1.json');
const project2 = require('./project_2.json');
const reference1 = require('./reference_1.json');
const reference2 = require('./reference_2.json'); // entropies and epitopes removed for comodity

// Set up the fake server and return an available connection to this server
// DANI: This has not been maintained in a while, expect problems when trying
const establishFakeConnection = async () => {
    let client;
    try {
        // If there is a provided connection string, try to connect to it
        // WARNING: The string connection may be not valid
        let connectionString;
        try {
            //connectionString = process.env.TEST_CONNECTION_STRING;
            const host = process.env.DB_SERVER || '127.0.0.1';
            const port = process.env.DB_PORT || '27017';
            const name = process.env.DB_NAME || 'mdposit';
            connectionString = `mongodb://${host}:${port}/${name}?`;
            client = await mongodb.MongoClient.connect(connectionString, { useNewUrlParser: true });
            connected = true;
            console.log('The provided connection string is valid: Connected to Mongo Memory Server');
        } catch (error) {
            console.error(
            chalk.red('The provided connection string is not valid: There is no active Mongo Memory Server'));
        }
        // In case  there is no connection string or it is not valid...
        // Create a new server and get the connection string
        if (!connected) {
            console.log('A new instance of Mongo Memory Server will be created');
            const mongod = new MongoMemoryServer();
            // If tnext line silently crashes try to type 'npm i mongodb-memory-server' in the terminal
            // DANI: Esto para la documentación:
            // Si después de instar mongodb memory server sigue fallando se puede activar el debug poniendo 'MONGOMS_DEBUG=1' en el archivo '.env'
            // A mi funcionó hacer 'sudo apt-get install libcurl3' y luego 'sudo apt-get install libcurl4 php-curl'
            connectionString = await mongod.getUri();
            client = await mongodb.MongoClient.connect(connectionString, { useNewUrlParser: true });
        }
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
