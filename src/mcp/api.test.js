const http = require('http');
const { createApi, createLocalFetch, createProbe } = require('./api');

describe('createApi', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const stubFetch = (status, body) => {
    const fetch = jest.fn(async () => new Response(body, { status }));
    global.fetch = fetch;
    return fetch;
  };

  it('repeats array params and skips undefined ones', async () => {
    const fetch = stubFetch(200, '{"ok":true}');
    const api = createApi('https://node.example/api/rest/v1');
    expect(await api('projects', { query: ['{"a":1}', '{"b":2}'], search: undefined, limit: 5 })).toEqual({ ok: true });
    const url = fetch.mock.calls[0][0];
    expect(url.pathname).toBe('/api/rest/v1/projects');
    expect(url.searchParams.getAll('query')).toEqual(['{"a":1}', '{"b":2}']);
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it.each([
    ['a JSON string', '"Project NOPE was not found"', 'Project NOPE was not found'],
    ['a JSON object', '{"error":"Wrong query syntax: {"}', 'Wrong query syntax: {'],
    ['an Express HTML page', '<!DOCTYPE html><html><body><pre>Cannot GET /rest/v1/projects/A0001/chains</pre></body></html>',
      'Cannot GET /rest/v1/projects/A0001/chains'],
  ])('reads the error message from %s', async (_, body, message) => {
    stubFetch(404, body);
    await expect(createApi('https://node.example/api/rest/v1/')('projects/x')).rejects.toThrow(
      `HTTP 404 from /api/rest/v1/projects/x: ${message}`);
    // Tools tell API answers apart by their status
    await expect(createApi('https://node.example/api/rest/v1/')('projects/x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createProbe', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads where and what a download serves from its headers', async () => {
    const response = new Response('ATOM...', { headers: {
      'content-type': 'chemical/x-pdb', 'content-length': '316824',
      'content-disposition': 'attachment; filename=A0001.1_structure.pdb',
    } });
    // The node's URL, after the global API redirected there
    Object.defineProperty(response, 'url', { value: 'https://irb.mddbr.eu/api/rest/v1/projects/A0001/structure' });
    const fetch = jest.fn(async () => response);
    global.fetch = fetch;
    expect(await createProbe('https://mdposit.mddbr.eu/api/rest/v1/')('projects/MD-A00001/structure')).toEqual({
      url: 'https://irb.mddbr.eu/api/rest/v1/projects/A0001/structure', filename: 'A0001.1_structure.pdb',
      contentType: 'chemical/x-pdb', bytes: 316824,
    });
    // Compressed responses would have no length
    expect(fetch.mock.calls[0][1]?.headers).toEqual({ 'accept-encoding': 'identity' });
  });
});

describe('createLocalFetch', () => {
  // Fake servers that record the Host header they get
  const seen = [];
  const servers = [];
  const listen = handler => new Promise(resolve => {
    const server = http.createServer((request, response) => {
      seen.push(request.headers.host);
      handler(request, response);
    });
    servers.push(server);
    server.listen(0, () => resolve(server.address().port));
  });
  let localUrl, nodeUrl;
  beforeAll(async () => {
    // Another node, where the global API redirects project data
    const nodePort = await listen((_, response) => response.end('{"node":true}'));
    nodeUrl = `http://127.0.0.1:${nodePort}/api/rest/v1/projects/A0001`;
    // The API this MCP runs in
    const localPort = await listen((request, response) => {
      if (request.url.endsWith('/MD-A00001')) response.writeHead(302, { location: nodeUrl }).end();
      else response.end('{"local":true}');
    });
    localUrl = `http://localhost:${localPort}/rest/v1/`;
  });
  beforeEach(() => seen.length = 0);
  afterAll(() => servers.forEach(server => server.close()));

  const localFetch = () => createLocalFetch({ localUrl, publicUrl: 'https://mdposit.mddbr.eu/api/rest/v1/', host: 'mdposit.mddbr.eu' });

  it('asks the local API for the original host and gives its public URL', async () => {
    const response = await localFetch()(new URL('projects/A0001', localUrl));
    expect(await response.json()).toEqual({ local: true });
    expect(seen).toEqual(['mdposit.mddbr.eu']);
    expect(response.url).toBe('https://mdposit.mddbr.eu/api/rest/v1/projects/A0001');
  });

  it('follows a redirect to another node without the original host', async () => {
    const response = await localFetch()(new URL('projects/MD-A00001', localUrl));
    expect(await response.json()).toEqual({ node: true });
    expect(seen).toEqual(['mdposit.mddbr.eu', new URL(nodeUrl).host]);
    expect(response.url).toBe(nodeUrl);
  });
});
