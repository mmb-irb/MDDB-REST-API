const express = require('express');
const paginate = require('express-paginate');
const cors = require('cors');
const swaggerUI = require('swagger-ui-express');
const yaml = require('yamljs');
const boxen = require('boxen');
const chalk = require('chalk');

const routes = require('../routes');
const getCustomTimeout = require('../middlewares/custom-timeout');

const PORT = 8000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const app = express();

// Disable this header
app.disable('x-powered-by');

// custom timeout middleware
app.use(
  getCustomTimeout({
    general: 5 * MINUTE,
    stale: 1 * MINUTE,
    extended: 1 * HOUR,
  }),
);

// Add CORS headers
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    exposedHeaders: ['content-length', 'content-range'],
  }),
);

// Pagination
app.use(paginate.middleware(DEFAULT_LIMIT, MAX_LIMIT));

// Root routes
app.get('/', (_, res) => res.json({ 'api types': ['rest'] }));
app.get('/rest', (_, res) =>
  res.json({
    'api versions': ['v1', 'current'],
    'current version': 'v1',
    documentation: 'docs',
  }),
);

// Routes with more logic
app.use('/rest/v1', routes);
app.use('/rest/current', routes);

// Swagger documentation parsed to an object
const swaggerDoc = yaml.load(`${__dirname}/../docs/description.yml`);

// Adapt the documentation to the current database name, prefix and url
const swaggerInfo = swaggerDoc.info;
swaggerInfo.title = swaggerInfo.title.replace(
  '$DATABASE',
  process.env.DOCS_DB_NAME,
);
swaggerInfo.description = swaggerInfo.description.replace(
  /\$DATABASE/g, // Use regexp instead of string in order to replace all matches
  process.env.DOCS_DB_NAME,
);
swaggerInfo.description = swaggerInfo.description.replace(
  '$CLIENT_URL', // Use regexp instead of string in order to replace all matches
  process.env.CLIENT_URL,
);
for (const path in swaggerDoc.paths) {
  swaggerDoc.paths[path].get.description = swaggerDoc.paths[
    path
  ].get.description.replace('$DATABASE', process.env.DOCS_DB_NAME);
}
swaggerDoc.components.schemas.Project.properties.accession.example = swaggerDoc.components.schemas.Project.properties.accession.example.replace(
  '$PREFIX',
  process.env.DOCS_DB_PREFIX,
);
swaggerDoc.definitions.constants.AccessionPattern = swaggerDoc.definitions.constants.AccessionPattern.replace(
  '$PREFIX',
  process.env.DOCS_DB_PREFIX,
);
swaggerDoc.definitions.arguments.projectAccessionOrID.description = swaggerDoc.definitions.arguments.projectAccessionOrID.description.replace(
  '$PREFIX',
  process.env.DOCS_DB_PREFIX,
);
swaggerDoc.definitions.arguments.projectAccessionOrID.schema.pattern = swaggerDoc.definitions.arguments.projectAccessionOrID.schema.pattern.replace(
  '$PREFIX',
  process.env.DOCS_DB_PREFIX,
);
swaggerDoc.definitions.arguments.projectAccessionOrID.example = swaggerDoc.definitions.arguments.projectAccessionOrID.example.replace(
  '$PREFIX',
  process.env.DOCS_DB_PREFIX,
);
swaggerDoc.servers[0].url = swaggerDoc.servers[0].url.replace(
  '$URL',
  process.env.DOCS_API_URL,
);

app.use(
  '/rest/docs',
  swaggerUI.serve,
  swaggerUI.setup(swaggerDoc, {
    customCss: `
      .swagger-ui .topbar {
        display: none;
      }
    `,
    customSiteTitle: `${process.env.DOCS_DB_NAME} API - Swagger Documentation`,
  }),
);

module.exports = {
  app,
  start() {
    return app.listen(PORT, () =>
      console.log(
        boxen(
          [
            `API running on ${chalk.bgCyan(`http://localhost:${PORT}`)}`,
            chalk.dim(`Using '${process.env.DB_NAME}' collection`),
            chalk.dim(
              `Running in '${chalk.green.bold(process.env.NODE_ENV)}' mode`,
            ),
          ].join('\n'),
          {
            padding: 1,
            margin: 1,
            borderStyle: 'round',
            borderColor: 'cyan',
          },
        ),
      ),
    );
  },
};
