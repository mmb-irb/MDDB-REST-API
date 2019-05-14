const paginate = require('express-paginate');
const cors = require('cors');
const swaggerUI = require('swagger-ui-express');
const yaml = require('yamljs');

const routes = require('../routes');

const PORT = 8000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const app = require('express')();

// Disable this header
app.disable('x-powered-by');

// Add CORS headers
app.use(
  cors({
    methods: ['GET', 'HEAD'],
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
      console.log(`API running on localhost:${PORT}`),
    );
  },
};
