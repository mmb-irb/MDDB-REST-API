// Library to read yaml files
const yaml = require('yamljs');
// Import the swagger logic
const swaggerUI = require('swagger-ui-express');
// Read the specification
const specification = yaml.load(`${__dirname}/description.yml`);
// Set some swagger configuration parameters
const swaggerConfig = {
    customCss: `.swagger-ui .topbar { display: none }`,
    customSiteTitle: `API - Federated specification`,
    swaggerOptions: {
        supportedSubmitMethods: [] // Disable all 'Try it out' buttons
    }
};
// Parse it with the Swagger logic
const swaggerSpec = swaggerUI.setup(specification, swaggerConfig);
module.exports = swaggerSpec;