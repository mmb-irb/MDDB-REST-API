const Router = require('express').Router;
const { ObjectId } = require('mongodb');
// A standard request and response handler used widely in most endpoints
const handler = require('../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../database');
// Get the project formatter
const projectFormatter = require('../../utils/project-formatter');
// Get auxiliar functions
const { parseJSON, getConfig } = require('../../utils/auxiliar-functions');
// Standard HTTP response status codes
const { BAD_REQUEST, INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');

const projectRouter = Router();

// Convert a string input into int, float or boolean type if possible
const parseType = input => {
  // Booleans
  if (input === 'false') return false;
  if (input === 'true') return true;
  // Numbers
  if (+input) return +input;
  // Other strings
  return input;
};

// Escape all regex sensible characters
const escapeRegExp = input => {
  return input.replace(/[-[/\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

// Root
projectRouter.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Set an object with all the parameters to performe the mongo query
      // Start filtering by published projects only if we are in production environment
      const finder = database.getBaseFilter();
      // Then, search by 'search' parameters
      // Look for the search text in the accession and some metadata/pdbInfo fields
      const search = request.query.search;
      if (search) {
        // trim() removes surrounding white spaces
        const tsearch = escapeRegExp(search.trim());
        // $regex is a mongo command to search for regular expressions inside fields
        // $options: 'i' stands for the search to be case insensitive
        if (!finder.$and) finder.$and = [];
        finder.$and.push( {
            $or: [
              { accession: { $regex: tsearch, $options: 'i' } },
              { 'metadata.NAME': { $regex: tsearch, $options: 'i' } },
              { 'metadata.DESCRIPTION': { $regex: tsearch, $options: 'i' } },
              { 'metadata.AUTHORS': { $regex: tsearch, $options: 'i' } },
              { 'metadata.GROUPS': { $regex: tsearch, $options: 'i' } },
              { 'metadata.PDBIDS': { $regex: tsearch, $options: 'i' } },
              { 'metadata.SYSKEYS': { $regex: tsearch, $options: 'i' } },
            ],
          });
      }
      // Then, filter by 'filter' parameters
      // Look for a specified value in any database field
      let filter = request.query.filter;
      if (filter) {
        // In case there is a single filter it would be a string, not an array, so adapt it
        if (typeof filter === 'string') filter = [filter];
        filter.forEach(f => {
          // The filters with '++' stand for 'OR'
          if (/\+\+/.test(f)) {
            // Extract the field name and the value by splitting the text by '++'
            const extract = f.split('++');
            // Push it to the proper finder array
            // First, check that the array to push exists and, if not, create it
            if (!finder.$or) finder.$or = [];
            finder.$or.push({ [extract[0]]: parseType(extract[1]) });
          }
          // The filters with '+*' stand for 'AND'
          else if (/\+\*/.test(f)) {
            // Extract the field name and the value by splitting the text by '+*'
            const extract = f.split('+*');
            // Push it to the proper finder array
            // First, check that the array to push exists and, if not, create it
            if (!finder.$and) finder.$and = [];
            finder.$and.push({ [extract[0]]: parseType(extract[1]) });
          }
          // The filters with '--' stand for 'OR NOT'
          else if (/--/.test(f)) {
            // Extract the field name and the value by splitting the text by '+*'
            const extract = f.split('--');
            // Push it to the proper finder array
            // First, check that the array to push exists and, if not, create it
            if (!finder.$or) finder.$or = [];
            finder.$or.push({
              [extract[0]]: { $not: { $eq: parseType(extract[1]) } },
            });
          }
          // // The filters with '-*' stand for 'AND NOT' (same as NOR)
          else if (/-\*/.test(f)) {
            // Extract the field name and the value by splitting the text by '+*'
            const extract = f.split('-*');
            // Push it to the proper finder array
            // First, check that the array to push exists and, if not, create it
            if (!finder.$and) finder.$and = [];
            finder.$and.push({
              [extract[0]]: { $not: { $eq: parseType(extract[1]) } },
            });
          }
        });
      }
      // Handle when it is a mongo query itself
      let query = request.query.query;
      if (query) {
        // Process the mongo query to convert references and topology queries
        const processedQuery = await database.processProjectsQuery(query);
        if (processedQuery.error) return processedQuery;
        if (!finder.$and) finder.$and = processedQuery;
        else finder.$and = finder.$and.concat(processedQuery);
      }
      // Set the projection object for the mongo query
      const projector = {};
      // Handle when it is a mongo projection itself
      // Note that when a projection is requested the project data is not formatted
      let projection = request.query.projection;
      if (projection) {
        // In case there is a single query it would be a string, not an array, so adapt it
        if (typeof projection === 'string') projection = [projection];
        for (const p of projection) {
          // Parse the string into a json object
          const objectProjection = parseJSON(p);
          if (!objectProjection) return {
            headerError: BAD_REQUEST,
            error: `Projection "${p}" is not well formatted`
          };
          // Append the specified projection to the projector object
          Object.assign(projector, objectProjection);
        }
      }
      // Set option to be passed
      const options = {};
      // The "score" refers to how similar is the result to the provided search terms (the string)
      // This is a standarized protocol in mongo to sort ".find" results according to their score
      // WARNING: It must be only used when a '$text' query command is passed
      // WARNING: Otherwise it will make the query fail for mongo version >= 4.4
      // DANI: Actualmente no se usa '$text' sino '$regex', de manera que esto no hace nada
      // DANI: Algun día podríamos necesitar usar '$text' así que mejor que esto se quede así
      if (finder.$text) {
        options.score = { $meta: 'textScore' };
        projector.score = { $meta: 'textScore' };
      }
      // Parse sort parameter if provided. 
      // To see why _id is always included, see below when cursor limit is set
      let sortOptions = { accession: 1, _id: 1 }; // Default sort
      if (request.query.sort) {
        const customSort = parseJSON(request.query.sort);
        sortOptions = customSort || sortOptions;
        // Add _id as secondary for documents that might not have updateDate
        if (sortOptions.updateDate !== undefined) {
          sortOptions._id = sortOptions.updateDate; // Use same direction as updateDate
        }
        // Otherwise preserve the _id secondary sort for consistency
        else {
          sortOptions._id = sortOptions._id || 1;
        }
      }
      // Get the number of projects to be matched with the current query
      let filteredCount = await database.projects.countDocuments(finder);
      // Finally, perform the mongo query
      // WARNING: If the query is wrong it will not make the code fail until the cursor in consumed
      // e.g. cursor.toArray()
      let cursor = await database.projects
        .find(finder, options)
        .project(projector)
         // For case-insensitive sorting
        .collation({ locale: 'en', strength: 2 })
        .sort(sortOptions);
      // If there are no results, we try it with the mongo internal ids
      // This only works with the full object id, not partial ids
      if (filteredCount === 0 && /[a-z0-9]{24}/.test(search)) {
        const id = ObjectId(search.match(/[a-z0-9]{24}/)[0]);
        const newFinder = { _id: id };
        filteredCount = await database.projects.countDocuments(newFinder);
        cursor = await database.projects.find(newFinder);
      }
      // If we still having no results then return here
      if (filteredCount === 0) return { filteredCount: 0, totalMdsCount: 0, projects: [] };

      // Get the limit of projects to be returned according to the query
      // If the query has no limit it is set to 10 by default
      // If the query limit is grater than 100 it is set to 100
      // If the limit is negative (which makes not sense) it is set to 0
      // This is defined in the src/server/index.js script
      let limit = request.query.limit;

      // Check if the raw flag has been passed
      // Besides, we use the raw project data if a projection is passed
      const raw = request.query.raw;
      const isRaw = (raw !== undefined && raw !== 'false') || Boolean(projection);

      // Set the project mapping function
      // If it must be raw the the mapping function dos nothing
      const projectMapping = isRaw ? project => project : projectFormatter;

      // Count total MDs across all matching projects
      // RUBEN: remove when mdcount is in all the databases
      const countTotalMds = async () => {
        const aggregation = await database.projects.aggregate([
          { $match: finder },
          { $project: { mdsCount: { $size: { $ifNull: ["$mds", []] } } } },
          { $group: { _id: null, totalMds: { $sum: "$mdsCount" } } }
        ]).toArray();
        
        return aggregation.length > 0 ? aggregation[0].totalMds : 0;
      };
      // Only calculate if explicitly requested
      const shouldCountMds = request.query.countMds === 'true';
      const totalMdsCount = shouldCountMds ? await countTotalMds() : null;

      // If the limit is set to 0 then return here
      if (limit === 0) return { filteredCount, totalMdsCount, projects: [] };

      // Finally consume the cursor
      const projects = await cursor
        // WARNING: Sorting by _id in second place is crucial for projects without accession, no never remove it
        // WARNING: Otherwise the sort may be totally inconsistent, which is very dangerous in combination with the 'skip'
        // We sort again. This time alphabetically by accession (*previous sort may be redundant)
        .sort(sortOptions)
        // Allow mongo to create temporally local files to handle the sort operation when reaching its 100Mb memory limit
        .allowDiskUse()
        // Avoid the first results when a page is provided in the request (URL)
        .skip(request.skip)
        // Avoid the last results when a limit is provided in the request query (URL)
        .limit(limit)
        // Each project is cleaned (some attributes are renamed or removed)
        // WARNING: Do not leave this line as 'map(projectMapping)' or you will have a bug
        // WARNING: The map function index is passed as requested MD index to the projectFormatter function
        .map(project => projectMapping(project))
        // Changes the type from Cursor into Array, then saving data in memory
        .toArray();
      return { filteredCount, totalMdsCount, projects };
    }
  }),
);

// Options
projectRouter.use('/options', require('./options'));

// Summary
projectRouter.use('/summary', require('./summary'));

// When the request (URL) contains a project parameter
// It is expected to be a project ID (e.g. .../projects/MCNS00001)
projectRouter.route('/:project').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Check if the raw flag has been passed
      const raw = request.query.raw;
      const isRaw = raw !== undefined && raw !== 'false';
      // Get project data, either raw or already formatted
      const projectData = isRaw
        ? await database.getRawProjectData()
        : await database.getProjectData();
      // Return project data as is
      return projectData;
    }
  }),
);

// Children routes (e.g. .../projects/A0001/files)

// Set a new local router for this
const localRouter = Router();

// The structure
localRouter.use('/:project/structure', require('./structure'));
// The trajectory
localRouter.use('/:project/trajectory', require('./trajectory'));
// Files
localRouter.use('/:project/files', require('./files'));
// Filenotes
localRouter.use('/:project/filenotes', require('./filenotes'));
// Chains
localRouter.use('/:project/chains', require('./chains'));
// Analyses
localRouter.use('/:project/analyses', require('./analyses'));
// References
localRouter.use('/:project/references', require('./references'));
// Inputs
localRouter.use('/:project/inputs', require('./inputs'));
// Topology
localRouter.use('/:project/topology', require('./topology'));

// If we are using the global API then any further query is mapped to the corresponding database
// Set a handler to be used for both GET and POST methods
const redirectHandler = handler({
  async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Get the project
    const projectData = await database.getProjectData();
    if (projectData.error) return projectData;
    // Set the local id to ask
    let localAccession = projectData.local;
    // Get the requested MD and add it to the local accession, if any
    const requestedMdIndex = database.requestedMdIndex;
    if (requestedMdIndex !== null) localAccession += `.${requestedMdIndex + 1}`;
    // Find the database thes project belongs to
    const nodeAlias = projectData.node;
    // Get the corresponding node
    const node = await database.nodes.findOne({ alias: nodeAlias });
    if (!node) return {
      headerError: INTERNAL_SERVER_ERROR,
      error: `Node "${nodeAlias}" not found`
    };
    // Get url path removing the first slash
    const urlPath = request.originalUrl.substring(1);
    // Replace the global id by the local id
    const splittedPath = urlPath.split('/');
    splittedPath[3] = localAccession;
    const replacedPath = splittedPath.join('/');
    // Build the new forwarded URL using the corresponding node API url
    const forwardedRef = node.api_url + replacedPath;
    // The response code must change depending on the request method
    let code;
    if (request.method === 'GET') code = 302;
    else if (request.method === 'POST') code = 307;
    else throw new Error(`Unsupported method ${request.method}`);
    return { code, url: forwardedRef };
  },
  // Handle the response body
  body(response, retrieved) {
    // If nothing is retrieved then end the response
    // Note that the header should end the response already, but just in case
    if (!retrieved) return response.end();
    // If there is any error in the body then just send the error
    if (retrieved.error) return response.json(retrieved.error);
    // Send the response
    response.redirect(retrieved.code, retrieved.url);
  },
});

// Now depending on the request host:
// Redirect to children routes if this is a local request
// Redirect to other APIs if this is a global request
const hostRedirection = (request, response, next) => {
  // Find out if the request host is configured as global
  const config = getConfig(request);
  const isGlobal = config && config.global;
  // Redirect accordingly
  if (isGlobal) return redirectHandler(request, response, next);
  return localRouter(request, response, next)
};
projectRouter.route('/:project/*').get(hostRedirection);
projectRouter.route('/:project/*').post(hostRedirection);

module.exports = projectRouter;
