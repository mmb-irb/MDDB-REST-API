// Serve the MCP server over Streamable HTTP, for clients of this API's hosts
const Router = require('express').Router;
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { getConfig, getHost } = require('../utils/auxiliar-functions');
const { createApi, createProbe, createLocalFetch } = require('./api');
const createPage = require('./page');
const createServer = require('./server');

const router = Router();

// The REST API as its clients reach it, which is where the download links point to
// Localhost serves it at /rest and every other host at /api/rest, as in the pointers endpoint
const getPublicUrl = (request, host) => {
  const protocol = request.get('x-forwarded-proto') || request.protocol;
  return `${protocol}://${host}${host.startsWith('localhost') ? '' : '/api'}/rest/`;
};

// Answers are always JSON, so clients which accept only JSON (e.g. Swagger or curl) may have them too
// The protocol asks for event streams to be accepted as well, which the transport checks in either the parsed or the raw headers
const ACCEPT = 'application/json, text/event-stream';
const acceptJson = request => {
  request.headers.accept = ACCEPT;
  const index = request.rawHeaders.findIndex((header, i) => i % 2 === 0 && header.toLowerCase() === 'accept');
  if (index === -1) request.rawHeaders.push('Accept', ACCEPT);
  else request.rawHeaders[index + 1] = ACCEPT;
};

// Every request gets its own server over the requested host's API, so no session is kept between requests
router.post('/', async (request, response) => {
  const host = getHost(request);
  const localUrl = `http://localhost:${process.env.LISTEN_PORT}/rest/v1/`;
  const fetchApi = createLocalFetch({ localUrl, publicUrl: `${getPublicUrl(request, host)}v1/`, host });
  const server = createServer(createApi(localUrl, fetchApi), createProbe(localUrl, fetchApi));
  // JSON responses rather than event streams, which the compression middleware would hold back
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    acceptJson(request);
    await server.connect(transport);
    // The body was already parsed by the JSON middleware
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: null,
    });
  }
});

// Browsers get a page about the server, while MCP clients asking for an event stream are refused below
router.get('/', async (request, response, next) => {
  if (request.accepts(['text/event-stream', 'html']) !== 'html') return next();
  const host = getHost(request);
  const { name, accession } = getConfig(request);
  const publicUrl = getPublicUrl(request, host);
  try {
    response.type('html').send(await createPage({
      name, accession: accession || 'A0001',
      mcpUrl: `${publicUrl}mcp`, apiUrl: `${publicUrl}v1/`, docsUrl: `${publicUrl}docs/`,
    }));
  } catch (error) {
    next(error);
  }
});

// Without sessions there is no stream to open with GET nor session to end with DELETE
router.all('/', (request, response) => response.status(405).set('Allow', 'POST').json({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed' },
  id: null,
}));

module.exports = router;
