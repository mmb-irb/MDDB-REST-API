const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { BAD_REQUEST, NOT_FOUND } = require('../../../utils/status-codes');
// Set the HTTP response status according to their codes
const HTTP_CODE_HEADERS = {
  400: BAD_REQUEST,
  404: NOT_FOUND,
};
// Set a error-proof JSON parser
const { getSearchQuery } = require('../../../utils/auxiliar-functions');

const router = Router({ mergeParams: true });

// Root
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Set an object with all the parameters to performe the mongo query
      // Start filtering by published projects only if we are in production environment
      const finder = database.getBaseFilter();
      // Handle when there is an automatic query
      let search = request.query.search;
      if (search) {
        // Process the mongo query to convert reference queries
        const searchQuery = getSearchQuery(search);
        if (!finder.$and) finder.$and = [ searchQuery ];
        else finder.$and = finder.$and.concat(searchQuery);
      }
      // Handle when there is a mongo query
      let query = request.query.query;
      if (query) {
        // Process the mongo query to convert reference queries
        const processedQuery = await database.processProjectsQuery(query);
        if (processedQuery.error) return processedQuery;
        if (!finder.$and) finder.$and = processedQuery;
        else finder.$and = finder.$and.concat(processedQuery);
      }
      // Get the requested projection
      let projection = request.query.projection;
      if (!projection) return {
        headerError: BAD_REQUEST,
        error: 'Missing projection'
      };
      if (typeof projection === 'string') projection = [projection];
      // Check if we must count the number of MDs as well
      const countMds = request.query.countMds
      const shouldCountMds = countMds !== undefined && countMds.toLowerCase() !== 'false';
      // Use the MDDB database counter to calculate this
      // Note that the result must be coherent with the the count from the loader
      const options = await database.countOptions(finder, projection, shouldCountMds);
      // If something was wrong parse the error codes to HTTP header
      if (options.error) options.headerError = HTTP_CODE_HEADERS[options.code];
      // Return the options object as is
      return options
    }
  }),
);

module.exports = router;