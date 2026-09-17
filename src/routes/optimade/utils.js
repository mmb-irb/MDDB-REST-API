const { version } = require('../../../package.json');

const OPTIMADE_VERSION = '1.2.0';
const DEFAULT_PAGE_LIMIT = 10;
const MAX_PAGE_LIMIT = 100;

const PROVIDER = {
  name: 'MDDB',
  description: 'Molecular Dynamics DataBase at IRB Barcelona',
  prefix: 'mddb',
  homepage: 'https://mddbr.eu/',
};

const IMPLEMENTATION = {
  name: 'MDDB REST API',
  version,
  source_url: 'https://github.com/mmb-irb/MDDB-REST-API',
  maintainer: { email: 'adam.hospital@irbbarcelona.org' },
};

function buildMeta({ query, dataReturned, dataAvailable, moreDataAvailable, warnings }) {
  const meta = {
    query: { representation: query || '/' },
    api_version: OPTIMADE_VERSION,
    time_stamp: new Date().toISOString(),
    data_returned: dataReturned,
    data_available: dataAvailable,
    more_data_available: moreDataAvailable,
    schema: 'https://schemas.optimade.org/openapi/v1.2/optimade.json',
    provider: PROVIDER,
    implementation: IMPLEMENTATION,
  };
  if (warnings && warnings.length) meta.warnings = warnings;
  return meta;
}

function buildLinks({ baseUrl, next = null }) {
  return { next, base_url: baseUrl };
}

function buildResponse({ data, meta, links }) {
  return { links, meta, data };
}

function getBaseUrl(request) {
  const proto = request.get('x-forwarded-proto') || request.protocol;
  const host = request.get('host');
  // Extract everything up to /optimade (preserving any reverse-proxy prefix like /api),
  // then always append /v1 so the base is correct regardless of where the request landed.
  const match = request.originalUrl.match(/^(.*\/optimade)/);
  const prefix = match ? match[1] : '/optimade';
  return `${proto}://${host}${prefix}/v1`;
}

// Returns the portion of the URL relative to /optimade/v1
function getQueryRepresentation(request) {
  return request.originalUrl.replace(/^\/optimade\/v1/, '') || '/';
}

// Parse and validate OPTIMADE pagination params from request
function getPagination(request) {
  const limit = Math.min(
    Math.max(0, parseInt(request.query.page_limit, 10) || DEFAULT_PAGE_LIMIT),
    MAX_PAGE_LIMIT,
  );
  const offset = Math.max(0, parseInt(request.query.page_offset, 10) || 0);
  return { limit, offset };
}

// Build the "next" page URL, or null if no more pages
function buildNextUrl(request, baseUrl, offset, limit, dataAvailable) {
  const nextOffset = offset + limit;
  if (nextOffset >= dataAvailable) return null;
  const url = new URL(request.originalUrl, `${request.protocol}://${request.get('host')}`);
  url.searchParams.set('page_limit', limit);
  url.searchParams.set('page_offset', nextOffset);
  // Rewrite path to be under the optimade base
  return url.toString();
}

// Filter response data to only include requested fields.
// Per OPTIMADE spec, `response_fields` limits which attributes are returned.
function applyResponseFields(data, responseFieldsParam) {
  if (!responseFieldsParam) return data;
  const fields = new Set(responseFieldsParam.split(',').map(f => f.trim()).filter(Boolean));
  if (!fields.size) return data;

  const filterEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const result = { id: entry.id, type: entry.type };
    if (entry.attributes !== undefined) {
      result.attributes = {};
      for (const f of fields) {
        // Include all requested fields; use null for fields not present in this entry
        result.attributes[f] = Object.prototype.hasOwnProperty.call(entry.attributes, f)
          ? entry.attributes[f]
          : null;
      }
    }
    if (entry.links) result.links = entry.links;
    if (entry.relationships) result.relationships = entry.relationships;
    return result;
  };

  return Array.isArray(data) ? data.map(filterEntry) : filterEntry(data);
}

// Resolve the OPTIMADE redirect URL for a project hosted on a local node.
// Returns null if project has no node info or node has no api_url.
// localPath: the OPTIMADE path segment after /optimade/v1/ using the LOCAL accession.
async function resolveLocalOptimadeUrl(database, project, localPath, request) {
  if (!project.node) return null;
  const nodeDoc = await database.nodes.findOne({ alias: project.node });
  if (!nodeDoc?.api_url) return null;
  const nodeUrl       = nodeDoc.api_url;
  const origin        = new URL(nodeUrl).origin;
  const currentOrigin = `${request.protocol}://${request.get('host')}`;
  // Same host (e.g. development) — no redirect needed, data is available locally
  if (origin === currentOrigin) return null;
  // Derive the OPTIMADE base from the node's api_url (preserving any path prefix like /api)
  const match        = nodeUrl.match(/^(.*\/optimade)/);
  const optimadeBase = match ? `${match[1]}/v1` : `${origin}/optimade/v1`;
  const search       = new URL(request.originalUrl, currentOrigin).search;
  return `${optimadeBase}/${localPath}${search}`;
}

module.exports = {
  OPTIMADE_VERSION,
  PROVIDER,
  IMPLEMENTATION,
  buildMeta,
  buildLinks,
  buildResponse,
  getBaseUrl,
  getQueryRepresentation,
  getPagination,
  buildNextUrl,
  applyResponseFields,
  resolveLocalOptimadeUrl,
};
