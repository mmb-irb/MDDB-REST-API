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
const swStats = require('swagger-stats');

const routes = require('../routes');
//const getCustomTimeout = require('../middlewares/custom-timeout');
const { version } = require('../../package.json');

// Auxiliar functions
const { getHost } = require('../utils/auxiliar-functions');

const PORT = process.env.LISTEN_PORT;
if (!PORT) throw new Error('Missing listen port in env');
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const app = express();

app.use(swStats.getMiddleware({swaggerSpec:swaggerSpec}));

// Disable this header
app.disable('x-powered-by');

// custom timeout middleware
// DANI: He quitado esto porque si no sabes que está aquí te mata las descargas largas silenciosamente
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

// Add POST request size limit
// Defualt would be 100Kb which is not enought
app.use(express.json({limit: '4mb'}));
// The extended has to be declared explicitly to avoid a warning
app.use(express.urlencoded({limit: '4mb', extended: false}));

// Pagination
app.use(paginate.middleware(DEFAULT_LIMIT, MAX_LIMIT));

// Parse POST request bodies
app.use(express.json());

// Set a directory for public files, if required
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (PUBLIC_DIR)
  app.use('/public', express.static(PUBLIC_DIR));

// Root routes
app.get('/', (_, res) => res.json({ 'api types': ['rest'] }));
app.get('/rest', (_, res) =>
  res.json({
    'api versions': ['v1', 'current'],
    'current version': 'v1',
    documentation: 'docs',
    'federated specification': 'spec',
    'software version': version,
  }),
);

// Routes with more logic
app.use('/rest/v1', routes);
app.use('/rest/current', routes);

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
