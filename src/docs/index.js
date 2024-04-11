// Import yaml to read the description.yml file
const yaml = require('yamljs');
// Import the swagger logic
const swaggerUI = require('swagger-ui-express');
const swaggerInit = swaggerUI.serve[0];
// Get the configuration parameters for the different requesting hosts
const hostConfig = require('../../config.js').hosts;
// Set the configuration for a hipotetical missing host
hostConfig[null] = {
  name: '(Unknown service)',
  description:
    'The requesting URL is not recognized, all simulations will be returned',
  prefix: 'MDP',
  collection: null,
};

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
    url = `http://${host}/rest/{version}`
  }
  else {
    // Otherwise do not specify the protocol
    `{protocol}://${host}/rest/{version}`
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

  // Adapt the documentation to the current database name and prefix by replacing some parts of the docs
  const swaggerInfo = swaggerDocs.info;
  swaggerInfo.title = swaggerInfo.title.replace('$DATABASE', config.name);
  swaggerInfo.description = swaggerInfo.description.replace(
    /\$DATABASE/g, // Use regexp instead of string in order to replace all matches
    config.name,
  );
  swaggerInfo.description = swaggerInfo.description.replace(
    '$CLIENT_URL', // Use regexp instead of string in order to replace all matches
    host,
  );
  for (const path in swaggerDocs.paths) {
    swaggerDocs.paths[path].get.description = swaggerDocs.paths[
      path
    ].get.description.replace('$DATABASE', config.name);
  }
  swaggerDocs.components.schemas.Project.properties.accession.example = swaggerDocs.components.schemas.Project.properties.accession.example.replace(
    '$PREFIX',
    config.prefix,
  );
  swaggerDocs.definitions.constants.AccessionPattern = swaggerDocs.definitions.constants.AccessionPattern.replace(
    '$PREFIX',
    config.prefix,
  );
  swaggerDocs.definitions.arguments.projectAccessionOrID.description = swaggerDocs.definitions.arguments.projectAccessionOrID.description.replace(
    '$PREFIX',
    config.prefix,
  );
  swaggerDocs.definitions.arguments.projectAccessionOrID.example = swaggerDocs.definitions.arguments.projectAccessionOrID.example.replace(
    '$PREFIX',
    config.prefix,
  );

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

const getSwaggerDocs = request => {
  // Get the hostname from the request
  const host = request.get('host');
  return swaggerResponses[host] || swaggerResponses[null];
};

module.exports = getSwaggerDocs;
