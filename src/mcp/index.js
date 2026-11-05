// Serve the MCP server over Streamable HTTP, for clients of this API's hosts
const Router = require('express').Router;
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { getHost } = require('../utils/auxiliar-functions');
const { createApi, createProbe, createLocalFetch } = require('./api');
const createServer = require('./server');

const router = Router();

// The REST API as its clients reach it, which is where the download links point to
// Localhost serves it at /rest and every other host at /api/rest, as in the pointers endpoint
const getPublicUrl = (request, host) => {
  const protocol = request.get('x-forwarded-proto') || request.protocol;
  return `${protocol}://${host}${host.startsWith('localhost') ? '' : '/api'}/rest/v1/`;
};

// Every request gets its own server over the requested host's API, so no session is kept between requests
router.post('/', async (request, response) => {
  const host = getHost(request);
  const localUrl = `http://localhost:${process.env.LISTEN_PORT}/rest/v1/`;
  const fetchApi = createLocalFetch({ localUrl, publicUrl: getPublicUrl(request, host), host });
  const server = createServer(createApi(localUrl, fetchApi), createProbe(localUrl, fetchApi));
  // JSON responses rather than event streams, which the compression middleware would hold back
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on('close', () => {
    transport.close();
    server.close();
  });
  try {
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

// Without sessions there is no stream to open with GET nor session to end with DELETE
router.all('/', (request, response) => response.status(405).set('Allow', 'POST').json({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed' },
  id: null,
}));

module.exports = router;
