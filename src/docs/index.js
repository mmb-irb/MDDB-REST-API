// Library to read yaml files
const yaml = require('yamljs');
// Import the swagger logic
const swaggerUI = require('swagger-ui-express');
const swaggerInit = swaggerUI.serve[0];
// Get the configuration parameters for the different requesting hosts
const hostConfig = yaml.load(`${__dirname}/../../config.yml`).hosts;
// Set the configuration for a hipotetical missing host
hostConfig[null] = {
  name: '(Unknown service)',
  description:
    'The requesting URL is not recognized, all simulations will be returned',
};

// Set a function to replace a string anywhere in a object/array full of nested strings
const replaceAnywhere = (targetObject, targetString, replaceString) => {
  // This works for both arrays and objects
  for (const inderOrKey in targetObject) {
    // Get the current value
    const value = targetObject[inderOrKey];
    // If it is a string then apply the replacement
    if (typeof value === 'string') targetObject[inderOrKey] = value.replaceAll(targetString, replaceString);
    // If it is an array or object then apply this function recursively
    else if (typeof targetObject === 'object') replaceAnywhere(value, targetString, replaceString);
    else throw new Error(`Unsupported type ${typeof value} when replacing anywhere`);
    // If this is an object and thus we are iterating its keys, then also replace the key strings
    if (typeof inderOrKey === 'string') {
      const replacedKey = inderOrKey.replaceAll(targetString, replaceString);
      targetObject[replacedKey] = targetObject[inderOrKey];
      delete inderOrKey;
    }
  }
};

// Elaborate the different possible swagger responsed depending on the request URL
const swaggerResponses = {};
Object.entries(hostConfig).forEach(([host, config]) => {
  // Swagger documentation parsed to an object
  const swaggerDocs = yaml.load(`${__dirname}/../docs/description.yml`);
  // Set the servers
  let url;
  if (host === `localhost`) {
    // Rewrite the host with the listen port
    host = `localhost:${process.env.LISTEN_PORT}`;
    // If this is the local host then use http to avoid problems
    url = `http://${host}/rest/{version}`;
  }
  else {
    // Otherwise do not specify the protocol
    url = `{protocol}://${host}/api/rest/{version}`;
  }
  
  swaggerDocs.servers = [
    {
      url: url,
      description: config.description,
      variables: {
        protocol: { enum: ['https', 'http'], default: 'https' },
        version: { enum: ['current', 'v1'], default: 'v1' },
      },
    },
  ];

  // Adapt the documentation to the current database name and accession example by replacing some parts of the docs
  replaceAnywhere(swaggerDocs, '$CLIENT_URL', host);
  replaceAnywhere(swaggerDocs, '$DATABASE', config.name);
  const accessionExample = config.accession || '< No example available >';
  replaceAnywhere(swaggerDocs, '$ACCESSION', accessionExample);

  // Remove the nodes endpoint documentation if this is not a global host
  if (!config.global) delete swaggerDocs.paths['/nodes'];

  // Set also the swagger options
  const swaggerOpts = {
    customCss: `.swagger-ui .topbar { display: none }`,
    customSiteTitle: `${config.name} API - Swagger Documentation`,
  };

  // Generate the html response for this swagger configuration
  const swaggerHtmlResponse = swaggerUI.generateHTML(swaggerDocs, swaggerOpts);

  // Now generate the response from the swagger serve
  // WARNING: This must be done after the generateHTML, since this function modifies the value of the generated JS script
  // WARNING: swaggerUI.serveFiles totally ignores swaggerDocs, so it is almost the same that swaggerUI.serve
  let swaggerUiInitJs;
  // We trick the serving function to make it think we are reciving a request
  // This way can capture the produced JS script
  const fakeRequest = { url: '/swagger-ui-init.js' };
  const fakeResponse = {
    set: () => {},
    send: js => {
      swaggerUiInitJs = js;
    },
  };
  const fakeNext = () => {};
  swaggerInit(fakeRequest, fakeResponse, fakeNext);

  // Save both the html and the js responses
  swaggerResponses[host] = { swaggerHtmlResponse, swaggerUiInitJs };
});

const getSwaggerDocs = host => swaggerResponses[host] || swaggerResponses[null];

module.exports = getSwaggerDocs;
