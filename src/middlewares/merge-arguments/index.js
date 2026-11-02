// Standard HTTP response status codes
const { BAD_REQUEST } = require('../../utils/status-codes');

// Arguments may be passed in both the query (e.g. GET) and the body (e.g. POST)
// This middleware merges body arguments into the query, so endpoints read all arguments from the query
// Body values are converted to the same format they would have in the query:
// Numbers and booleans become strings (e.g. 10 -> '10', false -> 'false')
// Objects become stringified JSON objects (e.g. a mongo query or projection)
// Lists keep being lists, but their values are converted as well
// If an argument is passed in both the query and the body then values must match
// Otherwise an error is returned, so no value is silently ignored

// Convert a single body value to its query format
// Return undefined if the value is not supported
const convertValue = value => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  return undefined;
};

// Convert a body argument to its query format
// Return undefined if the value is not supported (e.g. null or nested lists)
const convertArgument = value => {
  if (!Array.isArray(value)) return convertValue(value);
  const converted = value.map(convertValue);
  if (converted.some(v => v === undefined)) return undefined;
  return converted;
};

// Single values and lists with one value are equivalent
// e.g. '?ids=A0001' and '{ "ids": ["A0001"] }'
const areEqual = (a, b) => JSON.stringify([a].flat()) === JSON.stringify([b].flat());

// Merge the body arguments into the query
// Return an error if any argument is not valid or if query and body values do not match
const mergeArguments = request => {
  const merged = { ...request.query };
  for (const [name, value] of Object.entries(request.body)) {
    const converted = convertArgument(value);
    if (converted === undefined) return {
      headerError: BAD_REQUEST,
      error: `Wrong value for argument "${name}" in the request body: ${JSON.stringify(value)}. ` +
        'Values must be strings, numbers, booleans, objects or lists of them'
    };
    if (name in merged && !areEqual(merged[name], converted)) return {
      headerError: BAD_REQUEST,
      error: `Argument "${name}" was passed in both the query and the body with different values`
    };
    merged[name] = converted;
  }
  request.query = merged;
  return null;
};

const mergeArgumentsMiddleware = (request, response, next) => {
  const error = mergeArguments(request);
  if (error) return response.status(error.headerError).json(error.error);
  next();
};

module.exports = { mergeArguments, mergeArgumentsMiddleware };
