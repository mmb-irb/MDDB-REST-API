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

const labelNames = [
  'host', 'base_path', 'method', 'route', 'status_code', 'projectAccessionOrID', 'UniProtID',
  'PubChemID', 'PDBID', 'InChIKey', 'ChainSequence', 'CollectionID', 'filename', 
  'analysisName'
];
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: labelNames,
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: labelNames,
  buckets: [ 0.01, 0.1, 0.5, 1, 10],
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
  let basePath = 'none';
  for (const base of matchers.basePaths) {
    if (urlPath === base || urlPath.startsWith(`${base}/`)) {
      stripped = urlPath.slice(base.length) || '/';
      basePath = base;
      break;
    }
  }

  for (const { specPath, re, paramNames } of matchers.compiled) {
    const match = re.exec(stripped);
    if (match) {
      const params = {base_path: basePath};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { route: specPath, params };
    }
  }

  // No spec match — return a sanitised version to avoid high-cardinality labels
  // (replace values that look like IDs / filenames with a placeholder)
  const route = stripped
    .replace(/\/[a-fA-F0-9]{24}(\/|$)/g, '/{id}$1')   // MongoDB ObjectIds
    .replace(/\/[A-Z0-9]+\.[0-9]+(\/|$)/g, '/{accession}$1'); // accessions like A01X6.1

  return { route, basePath, params: {base_path: basePath} };
}

// Prefer proxy-provided client IPs when available.
function sanitizeIp(rawIp) {
  if (!rawIp) return '';

  let ip = String(rawIp).trim();
  if (!ip) return '';

  // Handle IPv4-mapped IPv6 values (e.g. ::ffff:192.168.0.1).
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }

  // Handle bracketed IPv6 with port (e.g. [2001:db8::1]:12345).
  const bracketedIpv6 = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) {
    ip = bracketedIpv6[1];
  }

  // Handle IPv4 with port (e.g. 192.168.0.1:12345).
  const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) {
    ip = ipv4WithPort[1];
  }

  return ip;
}

function getClientIp(req) {
  const xForwardedFor = req.headers && req.headers['x-forwarded-for'];

  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    // X-Forwarded-For can be a list: client, proxy1, proxy2
    return sanitizeIp(xForwardedFor.split(',')[0]);
  }

  if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    return sanitizeIp(String(xForwardedFor[0]).split(',')[0]);
  }

  return sanitizeIp(
    req.ip
    || (req.socket && req.socket.remoteAddress)
    || (req.connection && req.connection.remoteAddress)
    || ''
  );
}

function anonymizeIp(ip) {
  if (!ip) return 'Unknown';

  if (ip.includes('.')) {
    const octets = ip.split('.');
    if (octets.length >= 2) return `${octets[0]}.${octets[1]}.0.0`;
  }

  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}::`;
  }

  return 'Unknown';
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
    // Capture the full path NOW — req.path is mutated by Express after sub-router
    // dispatch, but req.originalUrl is always the original unmodified path.
    const fullPath = req.originalUrl.split('?')[0];
    if (fullPath.includes('favicon')) {
      return next();
    }
    if (debug) console.log(`Received request: ${req.method} ${fullPath}, path ${req.path}, url ${req.url}`)
    
    // IP and Geolocation logic
    const ip = getClientIp(req);
    if (debug) console.log('Client IP', ip);
    const geo = geoip.lookup(ip);
    if (debug) console.log('Geo Data', geo);
    
    req.geoStats = {
      country: geo ? geo.country : '',
      region: geo ? geo.region : '',
      city: geo ? geo.city : '',
      // Keep a coarse-grained anonymized IP in labels.
      anonIp: anonymizeIp(ip)
    };

    res.on('finish', () => {
      const { route, params } = normalizePath(fullPath, matchers);
      if (debug) console.log(`Normalized request: ${route}`);
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
      if (debug) console.log('Labels:', labels);
      if (debug) console.log('geoStats', req.geoStats);
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
