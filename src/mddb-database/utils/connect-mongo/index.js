const mongodb = require('mongodb');

// Set the required environmental variables to connect to Mongo
const REQUIRED_ENV = [ 'DB_SERVER', 'DB_PORT', 'DB_NAME',
    'DB_AUTH_USER', 'DB_AUTH_PASSWORD', 'DB_AUTHSOURCE'];

// Try to connect with the mongo db
const establishConnection = async () => {
    // Make sure we have the required enviornmental variables
    const missingEnv = REQUIRED_ENV.filter(env => !process.env[env]);
    if (missingEnv.length > 0) throw new Error(
        'Missing enviornmental variables: ' + missingEnv.join(', ') + '.\n' + 
        'Please define these variables in the ".env" file.');
    let client;
    try {
        client = await mongodb.MongoClient.connect(
            `mongodb://${process.env.DB_SERVER}:${process.env.DB_PORT}`,
            {
                auth: {
                username: process.env.DB_AUTH_USER,
                password: process.env.DB_AUTH_PASSWORD,
                },
                authSource: process.env.DB_AUTHSOURCE,
                useNewUrlParser: true,
                useUnifiedTopology: true,
            },
        );
        return client;
    } catch (error) {
        console.error('mongodb connection error');
        console.error(error);
        if (client && 'close' in client) client.close();
    }
};

module.exports = establishConnection();