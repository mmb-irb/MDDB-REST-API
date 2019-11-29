const mongodb = require('mongodb');

// Try to connect with the mongo db
const establishConnection = async () => {
  //console.log(url);
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
