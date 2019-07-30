const mongodb = require('mongodb');

const establishConnection = async () => {
  let client;
  try {
    client = await mongodb.MongoClient.connect(
      `mongodb://${process.env.DB_SERVER}:${process.env.DB_PORT}`,
      {
        auth: {
          user: process.env.DB_AUTH_USER,
          password: process.env.DB_AUTH_PASSWORD,
        },
        authSource: process.env.DB_AUTHSOURCE,
        useNewUrlParser: true,
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
