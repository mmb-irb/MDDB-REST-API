// Running in a worker
const { isMainThread, parentPort } = require('worker_threads');

if (isMainThread) throw new Error("This shouldn't run in the main thread!");

// if we hadn't done so before...
if (!global.window) {
  // get a fake DOM from jsdom
  const dom = new (require('jsdom')).JSDOM();
  // put on the global object all the things NGL asks for
  global.window = dom.window;
  global.Blob = dom.window.Blob;
  global.File = dom.window.File;
  global.FileReader = dom.window.FileReader;
}

const ngl = require('ngl');

const main = async (pdbFile, selection) => {
  console.log(pdbFile);
  const structure = await ngl.autoLoad(new global.Blob([pdbFile]), {
    ext: 'pdb',
  });
  const sel = new ngl.Selection(selection);
  const view = structure.getView(sel);
  // console.log(structure, { count: view.atomCount });
  const indices = [];
  view.eachAtom(atom => indices.push(atom.index));
  return indices.join(',');
};

// console.log(workerData, new global.Blob(workerData).size);

parentPort.addListener('message', async message => {
  if (message.type !== 'init') throw new Error('not a supported message');
  try {
    const output = await main(message.file, message.selection);
    parentPort.postMessage({ type: 'success', data: output });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error });
  }
});
