// Import yaml to read the description.yml file
const yaml = require('yamljs');
// Get the configuration parameters for the different requesting hosts
const hostConfig = require('../../config.js').hosts;

const getSwaggerDocs = request => {
  // Get the hostname from the request
  const host = request.get('host');
  // Get the configuration according to the hostname
  // Set also the default configuration in case the host is not recognized
  const config = hostConfig[host] || {
    name: '(Unknown service)',
    description:
      'The requesting URL is not recognized, all simulations will be returned',
    prefix: 'MDP',
    collection: null,
  };
  // Swagger documentation parsed to an object
  const swaggerDocs = yaml.load(`${__dirname}/../docs/description.yml`);
  // Set the servers
  swaggerDocs.servers = [
    {
      url: '{protocol}:' + host + '/api/rest/{version}',
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
  swaggerDocs.definitions.arguments.projectAccessionOrID.schema.pattern = swaggerDocs.definitions.arguments.projectAccessionOrID.schema.pattern.replace(
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

  return { swaggerDocs, swaggerOpts };
};

module.exports = getSwaggerDocs;
