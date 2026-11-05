// The page browsers get at /rest/mcp, telling users what the MCP server does and how to connect to it
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const createServer = require('./server');

const escape = text => String(text).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// The tools as clients list them, so the page never drifts from the server
// Listing them calls no API, so the server needs none
let tools;
const listTools = async () => {
  if (tools) return tools;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'mcp-page', version: '0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  ({ tools } = await client.listTools());
  await client.close();
  return tools;
};

// The first paragraph of a tool description is a summary of it, with arguments in backticks as code
const summarize = description => escape(description.split('\n\n')[0].replace(/\s+/g, ' '))
  .replace(/`([^`]+)`/g, '<code>$1</code>');

const getExamples = accession => [
  'Find membrane simulations of ACE2 and compare their force fields',
  `What is ${accession} made of, and how flexible is it? Summarize its RMSF by chain`,
  `Give me a download link for the first 100 frames of ${accession} as xtc`,
];

const STYLE = `
:root { --bg: #ffffff; --fg: #1d2330; --muted: #5b6475; --border: #dde1e8; --code: #f3f5f8; --accent: #1f6feb; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #12151b; --fg: #e4e7ed; --muted: #9aa3b2; --border: #2a303b; --code: #1b2029; --accent: #6ea8fe; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 48px 16px 64px; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 8px; }
h2 { font-size: 1.2rem; margin: 40px 0 12px; }
h3 { font-size: 1rem; margin: 20px 0 6px; }
p { margin: 0 0 12px; }
.lead { color: var(--muted); font-size: 1.05rem; }
a { color: var(--accent); }
code, pre { font: 0.9rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); border-radius: 6px; }
code { padding: 1px 5px; }
pre { padding: 12px 14px; overflow-x: auto; border: 1px solid var(--border); margin: 0 0 12px; }
pre code { padding: 0; background: none; }
.endpoint { display: flex; gap: 8px; align-items: stretch; margin: 20px 0 8px; }
.endpoint pre { flex: 1; margin: 0; }
button { font: inherit; font-size: 0.9rem; padding: 0 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--code); color: var(--fg); cursor: pointer; }
ul { padding-left: 20px; margin: 0 0 12px; }
dl { margin: 0; }
dt { font-weight: 600; margin-top: 14px; }
dt code { font-weight: 400; margin-left: 6px; }
dd { margin: 4px 0 0; color: var(--muted); }
`;

const createPage = async ({ name, accession, mcpUrl, apiUrl, docsUrl }) => {
  const toolList = (await listTools()).map(tool =>
    `<dt>${escape(tool.title || tool.name)} <code>${escape(tool.name)}</code></dt><dd>${summarize(tool.description)}</dd>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(name)} MCP server</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escape(name)} MCP server</h1>
<p class="lead">Let AI assistants such as Claude search ${escape(name)} simulations, read their analyses and topologies and get download links, through the <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer noopener">Model Context Protocol</a>.</p>
<div class="endpoint"><pre><code id="url">${escape(mcpUrl)}</code></pre><button type="button" id="copy">Copy</button></div>
<p>It is read-only, needs no account and keeps no session, so any client which speaks MCP over Streamable HTTP can use it.</p>

<h2>Connect</h2>
<h3>Claude Code</h3>
<pre><code>claude mcp add --transport http mddb ${escape(mcpUrl)}</code></pre>
<h3>Claude apps</h3>
<p>In Settings, go to Connectors, add a custom connector and paste the URL above.</p>
<h3>Other clients</h3>
<p>Most clients read a configuration such as this one:</p>
<pre><code>{
  "mcpServers": {
    "mddb": { "type": "http", "url": "${escape(mcpUrl)}" }
  }
}</code></pre>
<h3>Locally over stdio</h3>
<p>From a clone of the <a href="https://github.com/mmb-irb/MDDB-REST-API" target="_blank" rel="noreferrer noopener">API repository</a>, after <code>npm install</code>:</p>
<pre><code>claude mcp add mddb -e MDDB_API_URL=${escape(apiUrl)} -- node src/mcp/stdio.js</code></pre>

<h2>Try asking</h2>
<ul>${getExamples(accession).map(example => `<li>${escape(example)}</li>`).join('')}</ul>

<h2>Tools</h2>
<dl>${toolList.join('')}</dl>

<h2>See also</h2>
<p>The tools read the <a href="${escape(docsUrl)}">${escape(name)} REST API</a>, which you can query directly too.</p>
</main>
<script>
document.getElementById('copy').addEventListener('click', async event => {
  try {
    await navigator.clipboard.writeText(document.getElementById('url').textContent);
    event.target.textContent = 'Copied';
  } catch (error) {
    event.target.textContent = 'Copy failed';
  }
  setTimeout(() => event.target.textContent = 'Copy', 1500);
});
</script>
</body>
</html>`;
};

module.exports = createPage;
