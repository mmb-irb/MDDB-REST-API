// Make sure every MCP tool sends only arguments the endpoints support, so renaming or dropping an argument fails here
// The tools request the real routes, which reject unsupported arguments before reaching the database, never reached
jest.mock('../database', () => () => {
  throw new Error('The database must not be reached in this test');
});
// The server requires a listen port, although the test server listens in a random port
process.env.LISTEN_PORT = process.env.LISTEN_PORT || '0';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { app } = require('../server');
const { createApi, createProbe } = require('./api');
const createServer = require('./server');

// Every tool with every input it passes on to the API
const indices = { selection: 'protein', numbering: 'uniprot', atoms: '0', residues: '0', chains: '0' };
const CALLS = [
  ['search_projects', { text: 'spike', query: { 'metadata.TYPE': 'trajectory' }, fields: ['metadata.FF'],
    sort: { updateDate: -1 }, limit: 1, page: 1 }],
  ['project_options', { fields: ['metadata.FF'], text: 'spike', query: { 'metadata.TYPE': 'trajectory' } }],
  ['get_project', { accession: 'A0001' }],
  ['get_analysis', { accession: 'A0001', name: 'rmsds' }],
  ['get_topology', { accession: 'A0001' }],
  ['get_topology', { accession: 'A0001', residues: [0], atoms: [0] }],
  ['get_references', { accession: 'A0001' }],
  ['get_references', { type: 'proteins', id: 'P00918' }],
  ['find_simulations', { type: 'proteins', id: 'P00918' }],
  ['get_download_url', { accession: 'A0001', data: 'file', filename: 'structure.pdb' }],
  ['get_download_url', { accession: 'A0001', data: 'structure', format: 'mmcif', ...indices }],
  ['get_download_url', { accession: 'A0001', data: 'trajectory', format: 'xtc', frames: '1:10:2', ...indices }],
  ['get_download_url', { accession: 'A0001', data: 'coordinates', frames: '1:10:2', ...indices }],
  ['get_download_url', { accession: 'A0001', data: 'box', frames: '1:10:2' }],
];

let server;
let client;
beforeAll(async () => {
  await new Promise(resolve => server = app.listen(0, resolve));
  const apiUrl = `http://localhost:${server.address().port}/rest/v1/`;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(createApi(apiUrl), createProbe(apiUrl)).connect(serverTransport);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
});
afterAll(async () => {
  await client.close();
  await new Promise(resolve => server.close(resolve));
});

describe('MCP tool arguments', () => {
  test.each(CALLS)('%s sends arguments its endpoints support', async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    const message = result.content[0].text;
    // Calls fail at the database, which means their arguments were accepted
    expect(message).not.toMatch('Not supported argument');
    expect(message).toMatch(/^HTTP 500 from \/rest\/v1\//);
  });
});
