const client = require('prom-client');
const yaml = require('yamljs');
const geoip = require('geoip-lite');
const rawSpec = yaml.load(`${__dirname}/../../docs/description.yml`);
const { getHost } = require('../../utils/auxiliar-functions');
// ---------------------------------------------------------------------------
// Registry & default metrics
// ---------------------------------------------------------------------------

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ---------------------------------------------------------------------------
// Custom HTTP metrics
// ---------------------------------------------------------------------------

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['host', 'method', 'route', 'status_code', 'projectAccessionOrID', 'UniProtID', 'PubChemID', 'PDBID', 'filename', 'analysisName'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['host', 'method', 'route', 'status_code', 'projectAccessionOrID', 'UniProtID', 'PubChemID', 'PDBID', 'filename', 'analysisName'],
  buckets: [ 1, 50, 100, 500],
  registers: [register],
});

const httpGeoRequestsTotal = new client.Counter({
  name: 'http_geo_requests_total',
  help: 'Total number of HTTP requests by geographic location',
  labelNames: ['host', 'ip', 'country', 'region', 'city'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Path normalizer built from the OpenAPI spec
// ---------------------------------------------------------------------------

// Convert a spec path like /projects/{id}/files/{file} into a RegExp
// and an ordered list of param names, so we can match real URLs back to
// the template.  More-specific paths (fewer placeholders) are tried first.
function buildMatchers(basePaths) {
  const specPaths = Object.keys((rawSpec && rawSpec.paths) || {});

  // Pre-compile each spec path once
  const compiled = specPaths.map(specPath => {
    const paramNames = [];
    const regexSource = specPath
      .replace(/\{([^}]+)\}/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      // Escape dots in the static parts that remain
      .replace(/\./g, '\\.');
    return {
      specPath,
      paramNames,
      paramCount: paramNames.length,
      re: new RegExp(`^${regexSource}$`),
    };
  });

  // Sort: fewer placeholders = more specific = tried first
  compiled.sort((a, b) => a.paramCount - b.paramCount);

  return { compiled, basePaths };
}

function normalizePath(urlPath, matchers) {
  // Strip the API base prefix so we can match raw spec paths
  let stripped = urlPath;
  let appliedBase = '';
  for (const base of matchers.basePaths) {
    if (urlPath.startsWith(base)) {
      stripped = urlPath.slice(base.length) || '/';
      appliedBase = base;
      break;
    }
  }

  for (const { specPath, re, paramNames } of matchers.compiled) {
    const match = re.exec(stripped);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { route: appliedBase + specPath, params };
    }
  }

  // No spec match — return a sanitised version to avoid high-cardinality labels
  // (replace values that look like IDs / filenames with a placeholder)
  const route = urlPath
    .replace(/\/[a-fA-F0-9]{24}(\/|$)/g, '/{id}$1')   // MongoDB ObjectIds
    .replace(/\/[A-Z0-9]+\.[0-9]+(\/|$)/g, '/{accession}$1'); // accessions like A01X6.1

  return { route, params: {} };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Returns an Express middleware that records metrics for every response.
// Pass the parsed OpenAPI spec and the base paths used by the router.
function metricsMiddleware(basePaths = ['/rest/current', '/rest/v1'], debug = false) {
  if (!Array.isArray(basePaths)) {
    basePaths = ['/rest/current', '/rest/v1'];
  }
  const matchers = buildMatchers(basePaths);

  return function trackMetrics(req, res, next) {
    const startMs = Date.now();
    
    // IP and Geolocation logic
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
    if (debug) console.log('ip', ip);
    const geo = geoip.lookup(ip);
    if (debug) console.log('geo', geo);
    
    req.geoStats = {
      country: geo ? geo.country : 'Unknown',
      region: geo ? geo.region : 'Unknown',
      city: geo ? geo.city : 'Unknown',
      // Anonymize IP by keeping only the first two octets (e.g. 192.168.x.x)
      // This way we can still get some geographic info without needing consent
      anonIp: ip.length > 0 ? ip.split('.').slice(0, 2).join('.') + '.0.0' : 'Unknown'
    };
    if (debug) console.log('ip', req.geoStats);

    // Capture the full path NOW — req.path is mutated by Express after sub-router
    // dispatch, but req.originalUrl is always the original unmodified path.
    const fullPath = req.originalUrl.split('?')[0];
    const isFaviconRequest = fullPath.includes('favicon');
    const print = debug && !isFaviconRequest;
    if (print) console.log(`Received request: ${req.method} ${fullPath}, path ${req.path}, url ${req.url}`)

    res.on('finish', () => {
      const { route, params } = normalizePath(fullPath, matchers);
      if (print) console.log(`Normalized request: ${route}`);
      const host = getHost(req).split(':')[0];
      const labels = {
        host: host,
        // Disabled until we see if we can get real IPs under local network
        // ip: req.geoStats.anonIp,  
        method: req.method,
        route,
        status_code: String(res.statusCode),
        ...params
      };
      if (print) console.log('labels', labels);
      httpRequestsTotal.inc(labels);
      httpRequestDuration.observe(labels, (Date.now() - startMs) / 1000);
      httpGeoRequestsTotal.inc({
        host: host,
        ip: req.geoStats.anonIp,
        country: req.geoStats.country,
        region: req.geoStats.region,
        city: req.geoStats.city
      });
    });

    next();
  };
}

// Express route handler that serves the Prometheus text exposition format.
async function metricsEndpoint(req, res) {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = { 
  metricsMiddleware, 
  metricsEndpoint,
};
