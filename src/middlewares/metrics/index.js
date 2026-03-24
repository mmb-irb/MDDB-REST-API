const pm2 = require('pm2');
const yaml = require('yamljs');
const client = require('prom-client');
const geoip = require('geoip-lite');
const rawSpec = yaml.load(`${__dirname}/../../docs/description.yml`);
const { getHost } = require('../../utils/auxiliar-functions');


// ---------------------------------------------------------------------------
// Prometheus registry, default metrics & custom HTTP metrics
// ---------------------------------------------------------------------------

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const REQUEST_SOURCE_HEADER = 'x-mddb-request-source';
const REQUEST_SOURCE_DEFAULT = 'direct-api';

const labelNames = [
  'host', 'base_path', 'method', 'route', 'status_code', 'projectAccessionOrID', 'UniProtID',
  'PubChemID', 'PDBID', 'InChIKey', 'ChainSequence', 'CollectionID', 'filename', 
  'analysisName', 'md_num', 'source'
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
  buckets: [ 0.1, 1, 10, 30, 120, 600],
  registers: [register],
});

const httpGeoRequestsTotal = new client.Counter({
  name: 'http_geo_requests_total',
  help: 'Total number of HTTP requests by geographic location',
  labelNames: ['host', 'ip', 'country', 'region', 'city', 'source'],
  registers: [register],
});


// ---------------------------------------------------------------------------
// PM2 Cluster Registry Aggregation
// ---------------------------------------------------------------------------
// Reference: https://gist.github.com/yekver/34c9d41c1c4ea478151574ea539e9953

let pm2Bus;
const PM2_METRICS_TOPIC = 'get_prom_register';

function pm2exec(cmd, ...args) {
  if (!pm2) return Promise.reject(new Error('pm2 not initialized'));
  return new Promise((resolve, reject) => {
    pm2[cmd](...args, (err, resp) => (err ? reject(err) : resolve(resp)));
  });
}

// Filters for running PM2 instances
function getOnlineInstances(instancesData) {
  return instancesData.filter(({ pm2_env }) => pm2_env.status === 'online');
}

// Returns current instance's metrics
function getCurrentRegistry() {
  // Use AggregatorRegistry to prepare metrics for aggregation across instances
  return client.AggregatorRegistry.aggregate([register.getMetricsAsJSON()]);
}

// Requests metrics from all other PM2 instances by sending a message to each
function requestMetricsFromNeighbours(instancesData) {
  const targetInstanceId = Number(process.env.pm_id);
  const data = { topic: PM2_METRICS_TOPIC, data: { targetInstanceId } };

  Object.values(instancesData).forEach(({ pm_id }) => {
    if (pm_id !== targetInstanceId) {
      pm2exec('sendDataToProcessId', pm_id, data).catch(e => {
        console.error(`Failed to request metrics from instance #${pm_id}: ${e.message}`);
      });
    }
  });
}

// Collects and aggregates metrics from all online instances across PM2 cluster
async function getAggregatedRegistry(instancesData) {
  const onlineInstances = getOnlineInstances(instancesData);
  
  if (onlineInstances.length <= 1) {
    // Not in cluster or only one instance running
    return getCurrentRegistry();
  }

  const registryPromise = new Promise(async (resolve, reject) => {
    const registersList = [];
    const instanceId = Number(process.env.pm_id);
    const eventName = `process:${instanceId}`;
    let responsesCount = 1;
    let timeoutId;

    function sendResult() {
      if (pm2Bus) {
        pm2Bus.off(eventName);
      }
      resolve(client.AggregatorRegistry.aggregate(registersList));
    }

    function kickNoResponseTimeout() {
      timeoutId = setTimeout(() => {
        console.warn(
          `Metrics aggregation timeout. Only received from ${responsesCount} of ${onlineInstances.length} instances.`
        );
        sendResult();
      }, 1000);
    }

    try {
      // Add current instance's metrics
      registersList[instanceId] = getCurrentRegistry().getMetricsAsJSON();

      // Connect to PM2 bus if not already connected
      if (!pm2Bus) {
        pm2Bus = await pm2exec('launchBus');
      }

      // Set up listener for incoming metrics from other instances
      pm2Bus.on(eventName, packet => {
        if (packet.data && packet.data.register) {
          registersList[packet.data.instanceId] = packet.data.register;
          responsesCount++;
          clearTimeout(timeoutId);

          if (responsesCount === onlineInstances.length) {
            sendResult();
          } else {
            kickNoResponseTimeout();
          }
        }
      });

      kickNoResponseTimeout();
      
      // Request metrics from other instances
      requestMetricsFromNeighbours(onlineInstances);
    } catch (e) {
      console.error(`Error during metrics aggregation: ${e.message}`);
      reject(e);
    }
  });

  return registryPromise;
}

// ---------------------------------------------------------------------------
// PM2 Message Handler - Share metrics on request
// ---------------------------------------------------------------------------

if (pm2 && typeof process.env.pm_id !== 'undefined') {
  process.on('message', packet => {
    if (packet && packet.topic === PM2_METRICS_TOPIC) {
      try {
        process.send({
          type: `process:${packet.data.targetInstanceId}`,
          data: {
            instanceId: Number(process.env.pm_id),
            register: register.getMetricsAsJSON(),
          },
        });
      } catch (e) {
        console.error(`Error sending metrics to PM2: ${e.message}`);
      }
    }
  });

  // Initialize PM2 connection
  pm2exec('connect').catch(e => {
    console.debug(`PM2 connection error: ${e.message}`);
  });
}

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
  // Pre-compile each spec path once
  const compiled = specPaths.map(specPath => {
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
      const params = { base_path: basePath, md_num: '' };
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      // Split accessions like A0224.1 into accession + md number label.
      if (typeof params.projectAccessionOrID === 'string') {
        const mdMatch = params.projectAccessionOrID.match(/^(.+)\.(\d+)$/);
        if (mdMatch) {
          params.projectAccessionOrID = mdMatch[1];
          params.md_num = mdMatch[2];
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

  return { route, basePath, params: { base_path: basePath, md_num: '' } };
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

function isMetricsEnabled() {
  return process.env.NODE_ENV === 'development';
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
    if (!isMetricsEnabled()) {
      return next();
    }

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
    const requestSource = getRequestSource(req);
    if (debug) console.log('Client IP', ip);
    if (debug) console.log('Request source', requestSource);
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
        source: requestSource,
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
        city: req.geoStats.city,
        source: requestSource,
      });
    });

    next();
  };
}

// Express route handler that serves the Prometheus text exposition format.
// Supports PM2 cluster mode by aggregating metrics from all instances.
async function metricsEndpoint(req, res) {
  if (!isMetricsEnabled()) {
    return res.status(404).json({ error: 'Not Found' });
  }

  try {
    let aggregatedRegistry = register;

    // Check if running in PM2 cluster mode and aggregate metrics if available
    if (pm2 && typeof process.env.pm_id !== 'undefined') {
      try {
        const instancesData = await pm2exec('list');
        const onlineInstances = getOnlineInstances(instancesData);
        
        if (onlineInstances.length > 1) {
          // Multiple instances running - aggregate metrics
          aggregatedRegistry = await getAggregatedRegistry(instancesData);
        }
      } catch (e) {
        console.warn(`Failed to aggregate PM2 metrics, using local registry: ${e.message}`);
        // Fall back to local registry
      }
    }

    res.setHeader('Content-Type', aggregatedRegistry.contentType || register.contentType);
    const metrics = typeof aggregatedRegistry.metrics === 'function' 
      ? await aggregatedRegistry.metrics() 
      : aggregatedRegistry.metrics();
    res.end(metrics);
  } catch (err) {
    console.error(`Error in metricsEndpoint: ${err.message}`);
    res.setHeader('Content-Type', register.contentType);
    res.status(500).end('Internal Server Error: Failed to collect metrics');
  }
}

module.exports = { 
  metricsMiddleware, 
  metricsEndpoint,
};
