const compression = require('compression');
const zlib = require('zlib');

// Compress responses (brotli or gzip, as the client accepts)
// Low levels on purpose: topologies and structures can be tens of MB and higher levels cost seconds per request
// Only JSON (e.g. topologies, analyses) and PDB (structures) are compressed. Anything else is sent as it is
// WARNING: Do not use the default filter. It relies on mime-db, which flags application/octet-stream as compressible
// since mime-db 1.54. Binary trajectories do not compress, lose the content length the client needs to show the
// download progress, and grow 25% when written in small pieces (e.g. sparse atom selections)
const COMPRESSED_TYPES = ['application/json', 'chemical/x-pdb'];
const shouldCompress = (request, response) => {
  const contentType = String(response.getHeader('Content-Type')).split(';')[0].trim().toLowerCase();
  return COMPRESSED_TYPES.includes(contentType);
};

const compressionMiddleware = () => compression({
  level: 1,
  brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } },
  filter: shouldCompress,
});

module.exports = { compressionMiddleware, shouldCompress };
