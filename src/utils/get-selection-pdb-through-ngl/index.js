// This script contains the logic to start and manage a "worker"
// The worker contains the logic to get selection pdb

// POSSIBLE ERROR: Cannot find module 'worker_threads'
// Node must be version 11 or higher.
const { Worker } = require('worker_threads');
const getSelectionPDB = (pdbFile, selection) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(`${__dirname}/worker.js`);
    // Starts the worker
    worker.postMessage({ type: 'init', file: pdbFile, selection });
    // Recibes the worker output and terminates the worker
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

module.exports = getSelectionPDB;
