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
  res.json({ 'api versions': ['v1', 'current'], 'current version': 'v1' }),
);

// Routes with more logic
app.use('/rest/v1', routes);
app.use('/rest/current', routes);

// Swagger documentation
app.use(
  '/rest/docs',
  swaggerUI.serve,
  swaggerUI.setup(yaml.load(`${__dirname}/../docs/description.yml`), {
    customCss: `
      .swagger-ui .topbar {
        display: none;
      }
    `,
    customSiteTitle: 'MoDEL-CNS API - Swagger Documentation',
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
