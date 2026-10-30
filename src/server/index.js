const express = require('express');
const paginate = require('express-paginate');
const cors = require('cors');
const swaggerUI = require('swagger-ui-express');
const serveStatic = swaggerUI.serve[1];
const getSwaggerDocs = require(`${__dirname}/../docs`);
const swaggerSpec = require(`${__dirname}/../docs/specification`);
const boxen = require('boxen');
const chalk = require('chalk');
// logging for grafana
const { metricsMiddleware } = require('../middlewares/metrics');
const { compressionMiddleware } = require('../middlewares/compression');

const routes = require('../routes');
//const getCustomTimeout = require('../middlewares/custom-timeout');
const { version } = require('../../package.json');
// Software metadata, in CodeMeta format
const codemeta = {
  ...require('./codemeta.json'),
  version,
  downloadUrl: `https://github.com/mmb-irb/MDDB-REST-API/releases/tag/v${version}`,
};

// Auxiliar functions
const { getHost } = require('../utils/auxiliar-functions');
const {
  API_VERSION_NAMES,
  CURRENT_API_VERSION,
  apiVersionMiddleware,
} = require('../utils/api-version');
const { NOT_FOUND } = require('../utils/status-codes');

const PORT = process.env.LISTEN_PORT;
if (!PORT) throw new Error('Missing listen port in env');
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const app = express();

// Middleware to track endpoint usage and response times
app.use(metricsMiddleware());

// Disable this header
app.disable('x-powered-by');

// custom timeout middleware
// DANI: He quitado esto porque si no sabes que está aquí te mata las descargas largas silenciosamente
// const SECOND = 1000;
// const MINUTE = 60 * SECOND;
// const HOUR = 60 * MINUTE;
// app.use(
//   getCustomTimeout({
//     general: 5 * MINUTE,
//     stale: 1 * MINUTE,
//     extended: 1 * HOUR,
//   }),
// );

// Add CORS headers
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
    exposedHeaders: ['content-length', 'content-range'],
  }),
);

// Compress JSON and PDB responses
app.use(compressionMiddleware());

// Add POST request size limit
// Defualt would be 100Kb which is not enought
app.use(express.json({limit: '4mb'}));
// The extended has to be declared explicitly to avoid a warning
app.use(express.urlencoded({limit: '4mb', extended: false}));

// Save the query arguments sent by the user, before any middleware adds more (e.g. pagination)
// This way endpoints may reject unsupported arguments (see src/utils/check-arguments)
app.use((request, response, next) => {
  request.queryArguments = Object.keys(request.query);
  next();
});

// Pagination
app.use(paginate.middleware(DEFAULT_LIMIT, MAX_LIMIT));

// Parse POST request bodies
app.use(express.json());

// Set a directory for public files, if required
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (PUBLIC_DIR)
  app.use('/public', express.static(PUBLIC_DIR));

// Root routes
app.get('/', (_, res) => res.json({ 'api types': ['rest', 'optimade'] }));
app.get('/rest', (_, res) =>
  res.json({
    'api versions': API_VERSION_NAMES,
    'current version': `v${CURRENT_API_VERSION}`,
    documentation: 'docs',
    'federated specification': 'spec',
    'software version': version,
  }),
);

// EBRAINS software metadata in CodeMeta format
app.get('/rest/codemeta', (_, res) => {
  res.type('application/ld+json');
  res.send(JSON.stringify(codemeta, null, 2));
});

// Routes with more logic
// All versions share the same routes and the requested version is available through getApiVersion
for (const versionName of API_VERSION_NAMES)
  app.use(`/rest/${versionName}`, apiVersionMiddleware(versionName), routes);


// NEVER FORGET: El sistema recomendado para editar el swagger on the fly no me funcionaba bien y no me permitía pasar opciones
//    https://github.com/scottie1984/swagger-ui-express#modify-swagger-file-on-the-fly-before-load
// NEVER FORGET: El gran problema con el que perdí dos días
//    El gran problema solo aparecía al haber varias instancias en pm2
//    El gran problema consistía en que a veces el swagger recibido no se correspondía parcialmente con el solicitado
//    El orignel del problema está en el swagger, que al hacer el swaggerUI.setup modifica un script de js enviado más adelante:
//      Una vez ejecutada la primera request a '/rest/docs', cuyo valor de request.url es '/', se producen varias requests más
//      Estas requests tienen distintas urls, pero todas solicitan scripts de JS
//      El script problemático se llama swagger-ui-init.js y es enviado por la función swaggerUI.serve[0]*
//        * Recuerda que swaggerUI.serve no es una función, sino una lista con dos funciones
//      Este script construye el body del swagger, de manera que es crítico
//      El problema es que cada una de las request extras puede ir a parar una instancia distinta del pm2
//        Esto hace que a pesar de que el header esté bien, todo el body pueda ser el de otro swagger distinto
app.use('/rest/docs', (request, response, next) => {
  // Normalize docs base URL so relative Swagger assets resolve under /rest/docs/.
  // Use originalUrl to avoid redirect loops when /rest/docs/ is already requested.
  if (request.originalUrl === '/rest/docs') {
    response.redirect(301, '/rest/docs/');
    return next();
  }

  // Get the hostname from the request
  const host = getHost(request);
  response.set('internal-hostname', host); // This is usefull for debug
  // Get the swagger responses which correspond to the requesting host
  const swaggerResponses = getSwaggerDocs(host);
  const { swaggerHtmlResponse, swaggerUiInitJs } = swaggerResponses;
  // Send the html swagger base only in the first request
  if (request.url === '/') {
    response.send(swaggerHtmlResponse);
    return next();
  }
  // Send the swagger-ui-init.js script only when requested
  if (request.url === '/swagger-ui-init.js') {
    response.set('Content-Type', 'application/javascript');
    response.send(swaggerUiInitJs);
    return next();
  }
  // Load the rest of swagger stuff: scripts, css, etc.
  serveStatic(request, response, next);
});

// Federated specification
app.use('/rest/spec', swaggerUI.serve, swaggerSpec);

// Let the user know when the requested API version does not exist
// Only paths which look like a version (e.g. 'v9') are answered here
// Missing endpoints in existing versions or anything else fall through to the default 404
app.use('/rest/:version', (request, response, next) => {
  const versionName = request.params.version;
  if (!/^v\d+$/.test(versionName) || API_VERSION_NAMES.includes(versionName))
    return next();
  response
    .status(NOT_FOUND)
    .type('text/plain')
    .send(
      `API version '${versionName}' does not exist. ` +
        `Available versions: ${API_VERSION_NAMES.map(name =>
          name === 'current' ? `current (= v${CURRENT_API_VERSION})` : name,
        ).join(', ')}`,
    );
});

// OPTIMADE API — https://www.optimade.org/
// Specification: https://github.com/Materials-Consortia/OPTIMADE/blob/develop/optimade.rst
// LORE: Previously handled in a separate Docker container using optimade-python-tools
// LORE: (branch JPBergsma_BioExcel by Johan Bergsma, with MDDB compatibility layers)
// LORE: Now implemented natively in this Node.js server.
// Endpoints: /optimade  /optimade/v1/info  /optimade/v1/links
//            /optimade/v1/structures[/:id]  /optimade/v1/references[/:id]
//            /optimade/v1/trajectories[/:id]
app.use('/optimade', require('../routes/optimade'));

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
