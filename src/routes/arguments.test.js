// Make sure every documented endpoint supports exactly the documented arguments
// Supported arguments are found by requesting every endpoint with an unsupported argument
// Note that the database is never reached, since unsupported arguments are rejected before
jest.mock('../database', () => () => {
  throw new Error('The database must not be reached in this test');
});
// The server requires a listen port, although the test server listens in a random port
process.env.LISTEN_PORT = process.env.LISTEN_PORT || '0';

const yaml = require('yamljs');
const { app } = require('../server');

const docs = yaml.load(`${__dirname}/../docs/description.yml`);

// Endpoints whose supported arguments can not be found through the request
const UNCHECKED_ENDPOINTS = {
  // Supported range arguments depend on the file dimensions, so arguments are checked after reading the file
  'GET /projects/{projectAccessionOrID}/files/{filename}': true,
};

// Arguments which are supported but intentionally not documented
const TRAJECTORY_RANGE_ALIASES = ['bytes', 'x', 'coords', 'y', 'atoms', 'z'];
const UNDOCUMENTED_ARGUMENTS = {
  // Range aliases handled by 'handleRanges', including the legacy 'atoms'
  'GET /projects/{projectAccessionOrID}/trajectory': TRAJECTORY_RANGE_ALIASES,
  'POST /projects/{projectAccessionOrID}/trajectory': TRAJECTORY_RANGE_ALIASES,
  'GET /projects/{projectAccessionOrID}/trajectory/coordinates': TRAJECTORY_RANGE_ALIASES,
  'POST /projects/{projectAccessionOrID}/trajectory/coordinates': TRAJECTORY_RANGE_ALIASES,
  'GET /projects/{projectAccessionOrID}/trajectory/box': ['bytes', 'x', 'coords', 'y', 'vectors', 'z'],
  'POST /projects/{projectAccessionOrID}/trajectory/box': ['bytes', 'x', 'coords', 'y', 'vectors', 'z'],
  // These are only interesting for the monitor
  'GET /projects/{projectAccessionOrID}/filenotes': ['allmds', 'filenames'],
};

// Resolve a documentation reference (e.g. '#/definitions/arguments/projectAccessionOrID')
const resolve = value => value.$ref
  ? value.$ref.split('/').slice(1).reduce((object, key) => object[key], docs)
  : value;

// Get the documented arguments of an endpoint, in both the query and the body
const getDocumentedArguments = operation => {
  const parameters = (operation.parameters || []).map(resolve);
  const queryArguments = parameters.filter(parameter => parameter.in === 'query').map(parameter => parameter.name);
  const bodySchema = operation.requestBody && operation.requestBody.content['application/json'].schema;
  const bodyArguments = bodySchema ? Object.keys(bodySchema.properties) : [];
  return [...new Set([...queryArguments, ...bodyArguments])];
};

// Get the supported arguments from the error message when an unsupported argument is passed
const UNSUPPORTED_ARGUMENT = 'not_a_supported_argument';
const getSupportedArguments = async (method, path) => {
  const url = `${baseUrl}/rest/v1${path.replace(/\{[^}]+\}/g, 'A0001')}?${UNSUPPORTED_ARGUMENT}=1`;
  const response = await fetch(url, { method });
  const message = await response.json();
  expect(response.status).toBe(400);
  expect(message).toMatch(`Not supported argument(s): ${UNSUPPORTED_ARGUMENT}.`);
  if (message.endsWith('This endpoint supports no arguments')) return [];
  return message.split('Supported arguments are: ')[1].split(', ');
};

// Set every documented endpoint
const endpoints = [];
for (const [path, operations] of Object.entries(docs.paths)) {
  for (const [method, operation] of Object.entries(operations)) {
    const endpoint = `${method.toUpperCase()} ${path}`;
    if (UNCHECKED_ENDPOINTS[endpoint]) continue;
    endpoints.push([endpoint, method.toUpperCase(), path, operation]);
  }
}

let server;
let baseUrl;
beforeAll(done => {
  server = app.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    done();
  });
});
afterAll(done => {
  server.close(done);
});

describe('endpoint arguments', () => {
  test.each(endpoints)('%s supports the documented arguments', async (endpoint, method, path, operation) => {
    const supported = await getSupportedArguments(method, path);
    const undocumented = UNDOCUMENTED_ARGUMENTS[endpoint] || [];
    const expected = [...getDocumentedArguments(operation), ...undocumented];
    expect([...supported].sort()).toEqual([...expected].sort());
  });
});
