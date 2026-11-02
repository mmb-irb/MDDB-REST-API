// Standard HTTP response status codes
const { BAD_REQUEST } = require('../status-codes');

// Set the default number of results per page
const DEFAULT_LIMIT = 10;
// Set the default maximum number of results per page
const MAX_LIMIT = 100;

// Parse the pagination arguments in the request query: the page number and the limit of results per page
// Every endpoint may set its own limits
// If arguments are not valid or the limit is greater than the maximum allowed then return an error
const getPagination = (request, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) => {
  const { page = '1', limit = String(defaultLimit) } = request.query;
  if (!/^\d+$/.test(page) || Number(page) < 1) return {
    headerError: BAD_REQUEST,
    error: `Page "${page}" is not a positive integer`
  };
  if (!/^\d+$/.test(limit)) return {
    headerError: BAD_REQUEST,
    error: `Limit "${limit}" is not a non-negative integer`
  };
  if (Number(limit) > maxLimit) return {
    headerError: BAD_REQUEST,
    error: `Limit ${limit} is greater than the maximum allowed in this endpoint (${maxLimit}). ` +
      `Use the "page" argument to get further results.`
  };
  const pageNumber = Number(page);
  const limitNumber = Number(limit);
  const skip = (pageNumber - 1) * limitNumber;
  // Huge page numbers would break the skip in database queries
  if (!Number.isSafeInteger(skip)) return {
    headerError: BAD_REQUEST,
    error: `Page ${page} is too large`
  };
  return { page: pageNumber, limit: limitNumber, skip };
};

module.exports = getPagination;
