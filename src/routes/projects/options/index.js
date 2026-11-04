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
// Get auxiliar functions
const { getSearchQuery } = require('../../../utils/auxiliar-functions');
// Get the return parser
const { parseReturn } = require('mddb-database/utils/query-fields');

const router = Router({ mergeParams: true });

// Root
router.route('/').get(
  handler({
    supportedArguments: ['search', 'filter', 'return', 'countMds'],
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
      // Handle when there are filters
      const filterQueries = await database.processProjectsFilter(request.query.filter);
      if (filterQueries.error) return filterQueries;
      if (filterQueries.length > 0) finder.$and = (finder.$and || []).concat(filterQueries);
      // Get the fields whose options are to be returned
      const returnedFields = parseReturn(request.query.return);
      if (returnedFields.error) return returnedFields;
      if (returnedFields.length === 0) return {
        headerError: BAD_REQUEST,
        error: 'Missing fields to return'
      };
      // Check if we must count the number of MDs as well
      const countMds = request.query.countMds
      const shouldCountMds = countMds !== undefined && countMds.toLowerCase() !== 'false';
      // Use the MDDB database counter to calculate this
      // Note that the result must be coherent with the the count from the loader
      const options = await database.countOptions(finder, returnedFields, shouldCountMds, true);
      // If something was wrong parse the error codes to HTTP header
      if (options.error) options.headerError = HTTP_CODE_HEADERS[options.code];
      // Return the options object as is
      return options
    }
  }),
);

module.exports = router;