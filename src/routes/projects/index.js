const Router = require('express').Router;
const { ObjectId } = require('mongodb');
// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection = process.env.NODE_ENV === 'test'
  ? require('../../../test-helpers/mongo/index')
  : require('../../models/index');
const handler = require('../../utils/generic-handler');
// Get an automatic mongo query parser based on environment and request
const {
  getProjectQuery,
  getBaseFilter,
  getMdIndex,
} = require('../../utils/get-project-query');
// Get the project formatter
const { projectFormatter } = require('../../utils/get-project-data');
// Set a error-proof JSON parser
const { parseJSON } = require('../../utils/auxiliar-functions');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');

const { BAD_REQUEST, NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');

// Set if it is a global or a federated API
const isGlobal = process.env.DB_ROLE === 'global';
const isFederated = process.env.DB_ROLE === 'federated';
if (isGlobal === isFederated) throw new Error('API must be configured as global or federated (DB_ROLE)');

const projectRouter = Router();

// Set a header for queried fields to be queried in the references collection instead of projects
const referencesHeader = 'references.';

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

(async () => {
  // Save the mongo database connection
  const client = await dbConnection;
  // Access the database
  const db = client.db(process.env.DB_NAME);
  // Get the desired collections from the database
  const model = {}
  // Collections for the global API
  if (isGlobal) {
    model.projects = db.collection('global.projects');
    model.apis = db.collection('global.apis');
    Object.entries(REFERENCES).forEach(([referenceName, reference]) => {
      model[referenceName] = db.collection(`global.${reference.collectionName}`);
    });
  }
  // Collections for the federated API
  else {
    model.projects = db.collection('projects');
    model.topologies = db.collection('topologies');
    model.analyses = db.collection('analyses');
    model.files = db.collection('fs.files');
    model.chains = db.collection('chains');
    Object.entries(REFERENCES).forEach(([referenceName, reference]) => {
      model[referenceName] = db.collection(reference.collectionName);
    });
  }

  // Root
  projectRouter.route('/').get(
    handler({
      async retriever(request) {
        // Set an object with all the parameters to performe the mongo query
        // Start filtering by published projects only if we are in production environment
        const finder = getBaseFilter(request);
        // Then, search by 'search' parameters
        // Look for the search text in the accession and some metadata/pdbInfo fields
        const search = request.query.search;
        if (search) {
          // trim() removes surrounding white spaces
          const tsearch = escapeRegExp(search.trim());
          // $regex is a mongo command to search for regular expressions inside fields
          // $options: 'i' stands for the search to be case insensitive
          finder.$and = [
            {
              $or: [
                { accession: { $regex: tsearch, $options: 'i' } },
                { 'metadata.NAME': { $regex: tsearch, $options: 'i' } },
                { 'metadata.DESCRIPTION': { $regex: tsearch, $options: 'i' } },
                { 'metadata.AUTHORS': { $regex: tsearch, $options: 'i' } },
                { 'metadata.GROUPS': { $regex: tsearch, $options: 'i' } },
                { 'metadata.PDBIDS': { $regex: tsearch, $options: 'i' } }
              ],
            },
          ];
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
          // In case there is a single query it would be a string, not an array, so adapt it
          if (typeof query === 'string') query = [query];
          for (const q of query) {
            // Parse the string into an object
            const projectsQuery = parseJSON(q);
            if (!projectsQuery) return { error: BAD_REQUEST };
            // At this point the query object should correspond to a mongo query itself
            // Find fields which start with 'references'
            // These fields are actually intended to query the references collections
            // If we found references fields then we must query the references collection
            // Then each references field will be replaced by a query to 'metadata.REFERENCES' in the projects query
            // The value of 'metadata.REFERENCES' to be queried will be the matching uniprot ids
            const parseReferencesQuery = async original_query => {
              // Iterate over the original query fields
              for (const [field, value] of Object.entries(original_query)) {
                // If the field is actually a list of fields then run the parsing function recursively
                if (field === '$and' || field === '$or') {
                  for (const subquery of value) {
                    await parseReferencesQuery(subquery);
                  }
                  return;
                }
                // If the field does not start with the references header then skip it
                if (!field.startsWith(referencesHeader)) return;
                // Get the name of the field after substracting the symbolic header
                const referencesField = field.replace(referencesHeader, '');
                const referencesQuery = {};
                referencesQuery[referencesField] = value;
                // Query the references collection
                // WARNING: If the query is wrong it will not make the code fail until the cursor in consumed
                const referencesCursor = await model.references
                  .find(referencesQuery)
                  .project({ uniprot: true, _id: false });
                const results = await referencesCursor
                  .map(ref => ref.uniprot)
                  .toArray();
                // Update the original query by removing the original field and adding the parsed one
                delete original_query[field];
                original_query['metadata.REFERENCES'] = { $in: results };
              }
            };
            // Start the parsing function
            await parseReferencesQuery(projectsQuery);
            if (!finder.$and) finder.$and = [];
            finder.$and.push(projectsQuery);
          }
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
            if (!objectProjection) return { error: BAD_REQUEST };
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
        // Finally, perform the mongo query
        // WARNING: If the query is wrong it will not make the code fail until the cursor in consumed
        // e.g. cursor.toArray()
        let cursor = await model.projects
          .find(finder, options)
          .project(projector)
          .sort(options);
        // If there are no results, we try it with the mongo internal ids
        // This only works with the full object id, not partial ids
        if ((await cursor.count()) === 0 && /[a-z0-9]{24}/.test(search)) {
          const id = ObjectId(search.match(/[a-z0-9]{24}/)[0]);
          cursor = await model.projects.find({ _id: id });
        }
        // If we still having no results, return here
        if (cursor.count() === 0) return;

        // Get the limit of projects to be returned according to the query
        // If the query has no limit it is set to 10 by default
        // If the query limit is grater than 100 it is set to 100
        // This is defined in the src/server/index.js script
        // If the limit is negative (which makes not sense) it is set to 0
        let limit = request.query.limit;

        // Check if the raw flag has been passed
        // Besides, we use the raw project data if a projection is passed
        const raw = request.query.raw;
        const isRaw = (raw !== undefined && raw !== 'false') || Boolean(projection);

        // Set the project mapping function
        // If it must be raw the the mapping function dos nothing
        const projectMapping = isRaw ? project => project : projectFormatter;

        // 3 variables are declared at the same time
        const [filteredCount, projects] = await Promise.all([
          // filteredCount
          // WARNING: We must count before the limit or the count will be affected
          // WARNING: This was not like this in mongodb 3.3, but it changed when updated to mongodb 4.5
          cursor.count(),
          // If the request (URL) contains a limit query (i.e. ...?limit=x)
          limit
            ? cursor
                // WARNING: Sorting by _id in second place is crucial for projects without accession, no never remove it
                // WARNING: Otherwise the sort may be totally inconsistent, which is very dangerous in combination with the 'skip'
                // We sort again. This time alphabetically by accession (*previous sort may be redundant)
                .sort({ accession: 1, _id: 1 })
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
                .toArray()
            : [],
        ]);
        return { filteredCount, projects };
      },
      // If there is not filteredCount (the search was not sucessful), a NO_CONTENT status is sent in the header
      headers(response, { error, filteredCount }) {
        if (error) return response.status(error);
        // This header makes the response behave strangely sometimes
        // I prefere the response showing a clear 0 count and the empty projects list
        //if (filteredCount === 0) response.status(NO_CONTENT);
      },
      // Else, the projects list and the two counts are sent in the body
      body(response, retrieved) {
        // 'response.json' sends data in json format and ends the response
        if (retrieved) response.json(retrieved);
        else response.end();
      },
    }),
  );

  // Options
  projectRouter.use('/options', require('./options')(db, model));

  // Summary
  projectRouter.use('/summary', require('./summary')(db, model));

  // When the request (URL) contains a project parameter
  // It is expected to be a project ID (e.g. .../projects/MCNS00001)
  projectRouter.route('/:project').get(
    handler({
      async retriever(request) {
        // Set the project filter
        const projectFilter = getProjectQuery(request);
        // Do the query
        const projectData = await model.projects.findOne(projectFilter);
        if (!projectData) return {
          headerError: NOT_FOUND,
          error: `Project ${request.params.project} not found`
        };
        // Get the md number from the request
        const requestedMdIndex = getMdIndex(request);
        // If something went wrong with the MD request then return the error
        if (requestedMdIndex instanceof Error) return {
          headerError: BAD_REQUEST,
          error: requestedMdIndex.message
        };
        // Check if the raw flag has been passed
        const raw = request.query.raw;
        const isRaw = raw !== undefined && raw !== 'false';
        // Filter project data according to the requested MD index
        // Note that this function may include errors in the project
        if (!isRaw) projectFormatter(projectData, requestedMdIndex);
        // Return the project which matches the request project ID (accession)
        return projectData;
      },
      // Handle the response header
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
      },
    }),
  );

  // Children routes (e.g. .../projects/MCNS00001/files)

  // If we are using the global API then any further query is mapped to the corresponding database
  if (isGlobal) {
    // Set a handler to be used for both GET and POST methods
    const redirectHandler = handler({
      async retriever(request) {
        // Set the project filter
        const projectFilter = getProjectQuery(request);
        // Do the query
        const projectData = await model.projects.findOne(projectFilter);
        if (!projectData) return {
          headerError: NOT_FOUND,
          error: `Project ${request.params.project} not found`
        };
        // Get the md number from the request
        const requestedMdIndex = getMdIndex(request);
        // If something went wrong with the MD request then return the error
        if (requestedMdIndex instanceof Error) return {
          headerError: BAD_REQUEST,
          error: requestedMdIndex.message
        };
        // Set the local id to ask
        let localAccession = projectData.local;
        if (requestedMdIndex !== null) localAccession += `.${requestedMdIndex + 1}`;
        // Find the database thes project belongs to
        const apiAlias = projectData.api;
        // Get the corresponding api
        const api = await model.apis.findOne({ alias: apiAlias });
        if (!api) return {
          headerError: INTERNAL_SERVER_ERROR,
          error: `API ${apiAlias} not found`
        };
        // Get url path removing the first slash
        const urlPath = request.originalUrl.substring(1);
        // Replace the global id by the local id
        const splittedPath = urlPath.split('/');
        splittedPath[3] = localAccession;
        const replacedPath = splittedPath.join('/');
        // Build the new forwarded URL using the corresponding api url
        const forwardedRef = api.url + replacedPath;
        //console.log(forwardedRef);
        return forwardedRef;
      },
      // Handle the response header
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.redirect(retrieved);
      },
    });
    projectRouter.route('/:project/*').get(redirectHandler);
    projectRouter.route('/:project/*').post(redirectHandler);
  }
  // If it is a federated API then process the actual query
  else if (isFederated) {
    // The structure
    projectRouter.use('/:project/structure', require('./structure')(db, model));
    // The trajectory
    projectRouter.use('/:project/trajectory', require('./trajectory')(db, model));
    // Files
    projectRouter.use('/:project/files', require('./files')(db, model));
    // Filenotes
    projectRouter.use('/:project/filenotes', require('./filenotes')(db, model));
    // Chains
    projectRouter.use('/:project/chains', require('./chains')(db, model));
    // Analyses
    projectRouter.use('/:project/analyses', require('./analyses')(db, model));
    // References
    projectRouter.use('/:project/references', require('./references')(db, model));
    // Inputs
    projectRouter.use('/:project/inputs', require('./inputs')(db, model));
    // Topology
    projectRouter.use('/:project/topology', require('./topology')(db, model));
  }
})();

module.exports = projectRouter;
