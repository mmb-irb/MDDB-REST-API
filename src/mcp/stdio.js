// Run the MCP server over stdio against any MDDB REST API, for local clients such as Claude Code
// e.g. claude mcp add mddb -e MDDB_API_URL=https://irb.mddbr.eu/api/rest/v1/ -- node src/mcp/stdio.js
// Nothing else may write to stdout, which carries the protocol
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createApi, createProbe } = require('./api');
const createServer = require('./server');

const apiUrl = process.env.MDDB_API_URL || 'https://mdposit.mddbr.eu/api/rest/v1/';
createServer(createApi(apiUrl), createProbe(apiUrl)).connect(new StdioServerTransport());
