const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const createServer = require('./server');

const connect = async api => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(api, jest.fn()).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
};

describe('MCP server', () => {
  it('lists read-only tools, with the queryable fields in the search description', async () => {
    const client = await connect(jest.fn());
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['search_projects', 'project_options', 'get_project', 'get_analysis', 'get_topology', 'get_references', 'find_simulations', 'get_download_url']);
    expect(tools.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
    expect(tools[0].description).toContain('metadata.NUCLSEQ');
  });

  it('returns results as JSON text', async () => {
    const client = await connect(jest.fn(async () => ({ accession: 'A0001', metadata: { NAME: 'MoDEL 12CA' } })));
    const result = await client.callTool({ name: 'get_project', arguments: { accession: 'A0001' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({ accession: 'A0001', metadata: { NAME: 'MoDEL 12CA' } });
  });

  it('turns API errors into tool errors', async () => {
    const client = await connect(jest.fn(async () => { throw new Error('HTTP 404 from /projects/NOPE: not found'); }));
    const result = await client.callTool({ name: 'get_project', arguments: { accession: 'NOPE' } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HTTP 404 from /projects/NOPE');
  });
});
