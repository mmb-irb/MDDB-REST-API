/**
 * @jest-environment node
 */
// Test the inputs file of a project, used by the workflow to download and process the project again
// Requests go through the real router, while the database is faked with a project of several MDs
const http = require('http');
const express = require('express');
const { API_VERSION_NAMES, apiVersionMiddleware } = require('../../utils/api-version');
const { mergeArgumentsMiddleware } = require('../../middlewares/merge-arguments');

// MDs loaded since the workflow writes mmCIF structures, before it, and with no structure file
const getMockProject = () => ({
  accession: 'A0001',
  metadata: { NAME: 'Test project' },
  files: [{ name: 'topology.json' }],
  mdref: 0,
  mds: [
    { name: 'mmcif replica', files: [{ name: 'structure.cif' }, { name: 'trajectory.xtc' }] },
    { name: 'pdb replica', files: [{ name: 'structure.pdb' }, { name: 'trajectory.xtc' }] },
    { name: 'no structure replica', files: [{ name: 'trajectory.xtc' }] },
  ],
});
jest.mock('../../database', () => async () => ({ getRawProjectData: async () => getMockProject() }));

// Set an app with the endpoint, as the server does
const app = express();
app.use(express.json());
app.use((request, response, next) => {
  request.queryArguments = Object.keys(request.query);
  next();
});
for (const versionName of API_VERSION_NAMES)
  app.use(`/${versionName}/:project/inputs`, apiVersionMiddleware(versionName), mergeArgumentsMiddleware,
    require('./inputs'));
let server;
beforeAll(done => { server = app.listen(0, done) });
afterAll(done => { server.close(done) });

// Send a request and return the response status and the parsed JSON body
const getJson = path => new Promise((resolve, reject) => {
  http.get({ port: server.address().port, path }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
  }).on('error', reject);
});

describe('inputs file', () => {
  test('every MD points to its structure file, mmCIF when it has none', async () => {
    const response = await getJson('/v1/A0001/inputs?format=json');
    expect(response.status).toBe(200);
    const structureFiles = response.body.mds.map(md => md.input_structure_filepath.split('/').slice(-3).join('/'));
    expect(structureFiles).toEqual([
      'A0001.1/files/structure.cif',
      'A0001.2/files/structure.pdb',
      'A0001.3/files/structure.cif',
    ]);
  });

  test('file URLs point to the project whatever the query', async () => {
    const response = await getJson('/v1/A0001/inputs?format=json');
    const getPath = url => new URL(url).pathname;
    expect(getPath(response.body.mds[0].input_trajectory_filepaths)).toBe('/api/v1/A0001.1/files/trajectory.xtc');
    expect(getPath(response.body.input_topology_filepath)).toBe('/api/v1/A0001/files/topology.json');
  });
});
