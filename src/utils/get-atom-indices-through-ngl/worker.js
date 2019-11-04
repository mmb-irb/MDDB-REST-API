// Running in a worker
const { isMainThread, parentPort } = require('worker_threads');

// this should never be true as this is expected to run on a worker thread
if (isMainThread) throw new Error("This shouldn't run in the main thread!");

/**
 * Doing all sort of global stuff here, which is why we're running that in a
 * worker thread, so that it might not affect anything else
 */
// if we hadn't done so before...
if (!global.window) {
  // get a fake DOM from jsdom
  const dom = new (require('jsdom')).JSDOM();
  // put on the global object all the things NGL expects
  global.window = dom.window;
  global.Blob = dom.window.Blob;
  global.File = dom.window.File;
  global.FileReader = dom.window.FileReader;
}

// Now that we're good, load ngl
const ngl = require('ngl');

/**
 * This is the main part of the worker's logic
 *
 * @param {Buffer} pdbFile - Buffer containing the PDB reference file content
 * @param {string} selection - NGL-formatted selection (see http://nglviewer.org/ngl/api/manual/usage/selection-language.html)
 * @returns {string} Atom ranges, not collapsed, in a HTTP Range header format
 */
const main = async (pdbFile, selection) => {
  const structure = await ngl.autoLoad(new global.Blob([pdbFile]), {
    ext: 'pdb',
  });
  const sel = new ngl.Selection(selection);
  const view = structure.getView(sel);

  const indices = [];
  view.eachAtom(({ index }) => indices.push(`${index}-${index}`));

  return indices.join(',');
};

// main thread <=> worker thread communication
parentPort.addListener('message', async message => {
  if (message.type !== 'init') throw new Error('not a supported message');
  // The first message we receive should be of type 'init'
  try {
    // process the associated data
    const output = await main(message.file, message.selection);
    parentPort.postMessage({ type: 'success', data: output });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error });
  }
});
