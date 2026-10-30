/**
 * @jest-environment node
 */
// Test atom, residue and chain selections in the structure and trajectory endpoints
// Requests go through the real routers, while the database is faked with a small system
const http = require('http');
const { Readable } = require('stream');
const express = require('express');
const { BAD_REQUEST } = require('../../utils/status-codes');
const { API_VERSION_NAMES, apiVersionMiddleware } = require('../../utils/api-version');

// Chain A: residue 0 (atoms 0, 1), residue 1 (atoms 2, 3)
// Chain B: residue 2 (atoms 4, 5)
const ATOM_COUNT = 6;
const FRAME_COUNT = 2;
const mockTopology = {
  atom_names: ['N0', 'C0', 'N1', 'C1', 'N2', 'C2'],
  atom_elements: ['N', 'C', 'N', 'C', 'N', 'C'],
  atom_residue_indices: [0, 0, 1, 1, 2, 2],
  residue_names: ['ALA', 'GLY', 'LIG'],
  residue_numbers: [1, 2, 3],
  residue_icodes: {},
  residue_chain_indices: [0, 0, 1],
  chain_names: ['A', 'B'],
};
// Every coordinate is frame * 100 + atom * 10 + coordinate, so we know which atoms and frames are returned
const mockTrajectory = Buffer.alloc(FRAME_COUNT * ATOM_COUNT * 3 * 4);
for (let frame = 0; frame < FRAME_COUNT; frame++)
  for (let atom = 0; atom < ATOM_COUNT; atom++)
    for (let coordinate = 0; coordinate < 3; coordinate++)
      mockTrajectory.writeFloatLE(frame * 100 + atom * 10 + coordinate, ((frame * ATOM_COUNT + atom) * 3 + coordinate) * 4);
const mockFiles = {
  'structure.pdb': { _id: 'structure', filename: 'structure.pdb', length: 0 },
  'trajectory.bin': { _id: 'trajectory', filename: 'trajectory.bin', length: mockTrajectory.length,
    metadata: { atoms: ATOM_COUNT, frames: FRAME_COUNT } },
};
// The bucket fails when bytes beyond the file are requested, as GridFS does
const mockBucket = {
  openDownloadStream: (id, { start = 0, end = mockTrajectory.length } = {}) => {
    if (start > mockTrajectory.length || end > mockTrajectory.length) throw new Error(`Bytes ${start}-${end} beyond the file`);
    return Readable.from([mockTrajectory.subarray(start, end)]);
  },
};
const mockDatabase = {
  topologies: { findOne: async () => mockTopology },
  files: { findOne: async query => {
    const file = mockFiles[query.filename];
    return file && { ...file, metadata: { ...file.metadata } };
  } },
  bucket: mockBucket,
  STANDARD_STRUCTURE_FILENAME: 'structure.pdb',
  STANDARD_TRAJECTORY_FILENAME: 'trajectory.bin',
  // There is no box file, which is the usual case
  STANDARD_BOX_FILENAME: 'box.bin',
};
jest.mock('../../database', () => async () => ({
  ...mockDatabase,
  getProject: async () => new (require('../../database/project'))({ accession: 'A0001', internalId: 'id' }, mockDatabase),
}));

// Set an app with the endpoints, as the server does
const app = express();
app.use(express.json());
app.use((request, response, next) => {
  request.queryArguments = Object.keys(request.query);
  next();
});
for (const versionName of API_VERSION_NAMES) {
  app.use(`/${versionName}/:project/structure`, apiVersionMiddleware(versionName), require('./structure'));
  app.use(`/${versionName}/:project/trajectory`, apiVersionMiddleware(versionName), require('./trajectory'));
}
let server;
beforeAll(done => { server = app.listen(0, done) });
afterAll(done => { server.close(done) });

// Send a request and return the response status and body
// The body is sent as JSON (i.e. a POST request) when passed
const send = (path, body) => new Promise((resolve, reject) => {
  const data = body && JSON.stringify(body);
  const headers = data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {};
  const request = http.request({ port: server.address().port, path, method: data ? 'POST' : 'GET', headers }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
  });
  request.on('error', reject);
  request.end(data);
});
// Get the frame and atom of every atom in a trajectory, from the first coordinate of each atom
const getTrajectoryAtoms = body => {
  const atoms = [];
  for (let byte = 0; byte < body.length; byte += 12) {
    const value = Math.round(body.readFloatLE(byte));
    atoms.push(`frame ${Math.floor(value / 100)} atom ${(value % 100) / 10}`);
  }
  return atoms;
};
// Get the atom names in a PDB
const getStructureAtoms = body => body.toString().split('\n')
  .filter(line => line.startsWith('ATOM') || line.startsWith('HETATM'))
  .map(line => line.slice(12, 16).trim());

describe('trajectory selections', () => {
  const atoms3and4 = ['frame 0 atom 3', 'frame 0 atom 4', 'frame 1 atom 3', 'frame 1 atom 4'];

  test('ranged selections and lists select the same atoms', async () => {
    for (const [path, body] of [
      ['/v1/A0001/trajectory?atomindices=3-4'],
      ['/v1/A0001/trajectory?atomindices=3&atomindices=4'],
      ['/v1/A0001/trajectory', { atomindices: [3, 4] }],
      ['/v1/A0001/trajectory', { atomindices: ['3', '4'] }],
    ]) {
      const response = await send(path, body);
      expect(response.status).toBe(200);
      expect(getTrajectoryAtoms(response.body)).toEqual(atoms3and4);
    }
  });

  test('residue and chain lists given as strings select their atoms', async () => {
    const response = await send('/v1/A0001/trajectory', { chaindices: ['1'] });
    expect(getTrajectoryAtoms(response.body)).toEqual(['frame 0 atom 4', 'frame 0 atom 5', 'frame 1 atom 4', 'frame 1 atom 5']);
  });

  test('rejects indices beyond the system, in ranged selections and lists', async () => {
    for (const [path, body] of [
      ['/v1/A0001/trajectory?atomindices=0-99999999999'],
      ['/v1/A0001/trajectory?atomindices=6'],
      ['/v1/A0001/trajectory', { atomindices: [6] }],
      ['/v1/A0001/trajectory', { atomindices: [0, 99999999999] }],
      ['/v1/A0001/trajectory', { resindices: [3] }],
      ['/v1/A0001/trajectory', { chaindices: ['2'] }],
      ['/v1/A0001/trajectory', { atomindices: [-1] }],
      ['/v1/A0001/trajectory', { atomindices: ['a'] }],
    ]) expect((await send(path, body)).status).toBe(BAD_REQUEST);
  });
});

describe('structure selections', () => {
  test('ranged selections and lists select the same atoms', async () => {
    for (const [path, body] of [
      ['/v1/A0001/structure?atomindices=1-2'],
      ['/v1/A0001/structure?atomindices=1&atomindices=2'],
      ['/v1/A0001/structure', { atomindices: ['1', '2'] }],
    ]) {
      const response = await send(path, body);
      expect(response.status).toBe(200);
      expect(getStructureAtoms(response.body)).toEqual(['C0', 'N1']);
    }
  });

  test('rejects indices beyond the system, in ranged selections and lists', async () => {
    for (const [path, body] of [
      ['/v1/A0001/structure?atomindices=0-99999999999'],
      ['/v1/A0001/structure', { atomindices: [6] }],
      ['/v1/A0001/structure', { resindices: [3] }],
      ['/v1/A0001/structure', { chaindices: [2] }],
    ]) expect((await send(path, body)).status).toBe(BAD_REQUEST);
  });
});

describe('default formats', () => {
  test('structure is PDB in v1 and mmCIF since v2', async () => {
    for (const [path, contentType] of [
      ['/v1/A0001/structure', 'chemical/x-pdb'],
      ['/v2/A0001/structure', 'chemical/x-mmcif'],
      ['/current/A0001/structure', 'chemical/x-mmcif'],
      ['/v2/A0001/structure?format=pdb', 'chemical/x-pdb'],
    ]) {
      const response = await send(path);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe(contentType);
    }
  });

  // The content type is only set when the stored file has one, so check the output filename instead
  test('trajectory is bin in v1 and xtc since v2', async () => {
    for (const [path, extension] of [
      ['/v1/A0001/trajectory', 'bin'],
      ['/v2/A0001/trajectory', 'xtc'],
      ['/current/A0001/trajectory', 'xtc'],
      ['/v2/A0001/trajectory?format=bin', 'bin'],
    ]) {
      const response = await send(path);
      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toMatch(new RegExp(`\\.${extension}$`));
    }
  });
});
