// Standard HTTP response status codes
const { BAD_REQUEST } = require('../status-codes');

// Make sure the request has no arguments other than the supported ones
// Arguments may be passed in both the query (e.g. GET) and the body (e.g. POST)
// If there is any unsupported argument then return an error
// Note that the query arguments are read from the original query (see src/server/index.js)
// This is because some middlewares (e.g. pagination) add arguments to the query
const checkArguments = (request, supportedArguments) => {
  const supported = new Set(supportedArguments);
  const requestArguments = [...request.queryArguments, ...Object.keys(request.body)];
  const unsupportedArguments = [...new Set(requestArguments)].filter(arg => !supported.has(arg));
  if (unsupportedArguments.length === 0) return null;
  const supportedText = supportedArguments.length > 0
    ? `Supported arguments are: ${supportedArguments.join(', ')}`
    : 'This endpoint supports no arguments';
  return {
    headerError: BAD_REQUEST,
    error: `Not supported argument(s): ${unsupportedArguments.join(', ')}. ${supportedText}`
  };
};

module.exports = checkArguments;
