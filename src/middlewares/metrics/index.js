const yaml = require('yamljs');
const geoip = require('geoip-lite');
const rawSpec = yaml.load(`${__dirname}/../../docs/description.yml`);
const { getHost } = require('../../utils/auxiliar-functions');
const { SeverityNumber } = require('@opentelemetry/api-logs');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

// Setup the Exporter (Point to your OTel Collector)
const exporter = new OTLPLogExporter({
  url: 'http://otel-collector:4318/v1/logs',  // Default OTLP HTTP endpoint for logs
});

// OTel Resource Attributes as converted to Loki labels
// https://grafana.com/docs/loki/latest/send-data/otel/#format-considerations
const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'rest-api',  // This will become the "service_name" label in Loki
  }),
  processors: [new BatchLogRecordProcessor(exporter)]
});

// Create a logger and emit a log
const logger = loggerProvider.getLogger('metrics');


// ---------------------------------------------------------------------------
// Path normalizer built from the OpenAPI spec
// ---------------------------------------------------------------------------

// Convert a spec path like /projects/{id}/files/{file} into a RegExp
// and an ordered list of param names, so we can match real URLs back to
// the template.  More-specific paths (fewer placeholders) are tried first.
function buildMatchers(basePaths) {
  const specPaths = Object.keys((rawSpec && rawSpec.paths) || {});
  // Add inputs path manually as it is not documented
  specPaths.push('/projects/{projectAccessionOrID}/inputs');
  // Replace any reference ID placeholders with a common {referenceID} for matching purposes
  const referenceIdKeys = [
        'UniProtID', 'PubChemID', 'PDBID', 
        'InChIKey', 'ChainSequence', 'CollectionID'
      ];
  const normalizedSpecPaths = specPaths.map(path => {
    let normalizedPath = path;
    for (const key of referenceIdKeys) {
      normalizedPath = normalizedPath.replace(`{${key}}`, '{referenceID}');
    }
    normalizedPath = normalizedPath.replace(`{projectAccessionOrID}`, '{accession}');
    return normalizedPath;
  });
  // Pre-compile each spec path once
  const compiled = normalizedSpecPaths.map(specPath => {
    const paramNames = [];
    const regexSource = specPath
      // Captures text wrapped in curly braces, while replacing it with a regex group
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

// Extract the params from the URL path based on the OpenAPI spec
// Possible params: base_path, accession, referenceID, filename, analysisName, source, ip
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

  // Canonicalize trailing slash so /foo and /foo/ map to the same route label.
  const normalizedStripped = stripped === '/' ? '/' : (stripped.replace(/\/+$/g, '') || '/');

  for (const { specPath, re, paramNames } of matchers.compiled) {
    const match = re.exec(normalizedStripped);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      // Split accessions like A0224.1 into accession + md number label and
      if (typeof params.accession === 'string') {
        const mdMatch = params.accession.match(/^(.+)\.(\d+)$/);
        if (mdMatch) {
          params.accession = mdMatch[1];
          // params.md_num = mdMatch[2];
        }
      }
      return { route: specPath, params };
    }
  }

  // No spec match — return a sanitised version to avoid high-cardinality labels
  // (replace values that look like IDs / filenames with a placeholder)
  const route = normalizedStripped
    .replace(/\/[a-fA-F0-9]{24}(\/|$)/g, '/{id}$1')   // MongoDB ObjectIds
    .replace(/\/[A-Z0-9]+\.[0-9]+(\/|$)/g, '/{accession}$1'); // accessions like A01X6.1

  return { route, basePath, params: {} };
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

const REQUEST_SOURCE_HEADER = 'x-mddb-request-source';
const REQUEST_SOURCE_DEFAULT = 'direct-api';

function getRequestSource(req) {
  const rawSource = req.headers && req.headers[REQUEST_SOURCE_HEADER];
  const source = Array.isArray(rawSource) ? rawSource[0] : rawSource;

  if (!source || !String(source).trim()) {
    return REQUEST_SOURCE_DEFAULT;
  }

  // Keep labels low-cardinality and Prometheus-safe.
  const normalized = String(source)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, 64);

  return normalized || REQUEST_SOURCE_DEFAULT;
}


function isLoggingEnabled() {
  // Enable logging in production by default, or use an env var
  return process.env.NODE_ENV === 'development';
}

// Recursively remove keys with empty string, null, or undefined values from objects
function removeEmpty(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeEmpty);
  } else if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== '' && v !== null && v !== undefined)
        .map(([k, v]) => [k, removeEmpty(v)])
    );
  }
  return obj;
}

// Express middleware for Loki logging
// Pass the parsed OpenAPI spec and the base paths used by the router.
function metricsMiddleware(basePaths = ['/rest/current', '/rest/v1'], debug = false) {
  if (!Array.isArray(basePaths)) {
    basePaths = ['/rest/current', '/rest/v1'];
  }
  const matchers = buildMatchers(basePaths);

  return function lokiLoggerMiddleware(req, res, next) {
    if (!isLoggingEnabled()) {
      return next();
    }

    const startMs = Date.now();
    // Capture the full path NOW — req.path is mutated by Express after sub-router
    // dispatch, but req.originalUrl is always the original unmodified path.
    const fullPath = req.originalUrl.split('?')[0];
    if (fullPath.includes('favicon')) {
      return next();
    }
    if (debug) console.log(`Received request: ${req.method} ${fullPath}, path ${req.path}, url ${req.url}`);

    // IP and Geolocation logic
    const ip = getClientIp(req);
    const requestSource = getRequestSource(req);
    if (debug) console.log('Client IP', ip);
    if (debug) console.log('Request source', requestSource);
    const geo = geoip.lookup(ip);
    if (debug) console.log('Geo Data', geo);

    req.geoStats = {
      country: geo ? geo.country : '',
      region: geo ? geo.region : '',
      city: geo ? geo.city : '',
      ip: anonymizeIp(ip)
    };

    res.on('finish', () => {
      const { route, params } = normalizePath(fullPath, matchers);
      if (debug) console.log(`Normalized request: ${route}`);
      const host = getHost(req).split(':')[0];
      data = {
        status_code: res.statusCode,
        latency: (Date.now() - startMs) / 1000,
        route,
        ...params,
        ...req.geoStats,
      }
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: 'INFO',
        attributes: removeEmpty(data),
      });
    });

    next();
  };
}


module.exports = { 
  metricsMiddleware
};
