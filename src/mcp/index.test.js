// auxiliar-functions loads config.yml through yamljs, which fails under jest, and the host is all the route needs
jest.mock('../utils/auxiliar-functions', () => ({ getHost: () => 'irb.mddbr.eu' }));
const http = require('http');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const router = require('.');

const listen = server => new Promise(resolve => server.listen(0, () => resolve(server.address().port)));

describe('MCP endpoint', () => {
  const hosts = [];
  let apiServer, appServer, mcpUrl;
  beforeAll(async () => {
    // A stand-in for the REST API this MCP runs in, with one project and its structure
    apiServer = http.createServer((request, response) => {
      hosts.push(request.headers.host);
      if (request.url.startsWith('/rest/v1/projects/A0001/structure')) {
        response.writeHead(200, { 'content-type': 'chemical/x-pdb', 'content-length': 5,
          'content-disposition': 'attachment; filename=A0001.1_structure.pdb' });
        response.end('ATOM\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accession: 'A0001', metadata: { NAME: 'MoDEL 12CA' } }));
    });
    process.env.LISTEN_PORT = await listen(apiServer);
    const app = express();
    app.use(express.json());
    app.use('/rest/mcp', router);
    appServer = http.createServer(app);
    mcpUrl = new URL(`http://127.0.0.1:${await listen(appServer)}/rest/mcp`);
  });
  beforeEach(() => hosts.length = 0);
  afterAll(() => {
    apiServer.close();
    appServer.close();
  });

  // Apache tells the API that clients came through https
  const connect = async () => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl,
      { requestInit: { headers: { 'x-forwarded-proto': 'https' } } }));
    return client;
  };
  const callTool = async (name, args) => {
    const client = await connect();
    const result = await client.callTool({ name, arguments: args });
    await client.close();
    return JSON.parse(result.content[0].text);
  };

  it('reads the API of the requested host', async () => {
    expect(await callTool('get_project', { accession: 'A0001' })).toEqual({ accession: 'A0001', metadata: { NAME: 'MoDEL 12CA' } });
    expect(hosts).toEqual(['irb.mddbr.eu']);
  });

  it('gives download links on the public URL of the requested host', async () => {
    expect(await callTool('get_download_url', { accession: 'A0001', data: 'structure' })).toEqual({
      url: 'https://irb.mddbr.eu/api/rest/v1/projects/A0001/structure', filename: 'A0001.1_structure.pdb',
      contentType: 'chemical/x-pdb', bytes: 5,
    });
  });

  it('keeps no session between requests', async () => {
    const client = await connect();
    expect(client.transport.sessionId).toBeUndefined();
    await client.close();
  });
});
