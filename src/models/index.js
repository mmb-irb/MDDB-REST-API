const mongoose = require('mongoose');
const mongodb = require('mongodb');

const LOCAL = process.env.NODE_ENV === 'local';

const establishConnection = async error => {
  if (error) {
    console.error('tunnel error');
    console.error(error);
  }
  let mongoConfig;
  try {
    // mongo config file, can be json or js code
    mongoConfig = require('../../configs/mongo');
  } catch (_) {
    console.error("couldn't find mongo config file");
    return;
  }
  try {
    const connection = await mongoose.connect(
      `mongodb://${mongoConfig.server}:${mongoConfig.port}/admin`,
      {
        ...mongoConfig.auth,
        useNewUrlParser: true,
      },
    );

    const schema = new mongoose.Schema({});
    const model = mongoose.model('any', schema);
    model.find({}, (...args) => console.log(...args));
  } catch (error) {
    console.error('mongodb connection error');
    console.error(error);
  }
};

if (LOCAL) {
  try {
    // See https://github.com/agebrock/tunnel-ssh/blob/master/README.md#config-example
    // for example configuration, file can be json or js code
    const sshTunnelConfiguration = require('../../configs/ssh-tunnel');
    const tunnel = require('tunnel-ssh');
    tunnel(sshTunnelConfiguration, establishConnection);
  } catch (error) {
    console.error(error);
    console.warn('Not using a SSH tunnel since config is missing');
    establishConnection();
  }
} else {
  establishConnection();
}
