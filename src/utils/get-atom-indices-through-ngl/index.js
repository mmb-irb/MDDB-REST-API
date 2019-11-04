const { Worker } = require('worker_threads');

const getAtomIndices = (pdbFile, selection) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(`${__dirname}/worker.js`);

    worker.postMessage({ type: 'init', file: pdbFile, selection });

    worker.addListener('message', message => {
      worker.unref();
      worker.terminate();
      if (message.type === 'success') {
        resolve(message.data);
      } else {
        reject(message.error);
      }
    });
  });

module.exports = getAtomIndices;
