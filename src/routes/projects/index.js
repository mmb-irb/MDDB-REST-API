const Router = require('express').Router;
const { ObjectId } = require('mongodb');
// This function returns an object without the selected omitted attributes
const omit = require('lodash').omit;
// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection =
  process.env.NODE_ENV === 'test'
    ? require('../../../test-helpers/mongo/index')
    : require('../../models/index');
const handler = require('../../utils/generic-handler');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../utils/published-filter');
// Adds the project associated ID from mongo db to the provided object
const augmentFilterWithIDOrAccession = require('../../utils/augment-filter-with-id-or-accession');

const {
  BAD_REQUEST,
  NO_CONTENT,
  NOT_FOUND,
} = require('../../utils/status-codes');

const projectRouter = Router();

// This function renames the "_id" attributes from the project and from their pdbInfo attribute as "identifier"
// In addition, it removes the "_id" and other 2 attributes from the files
const projectObjectCleaner = project => {
  // Add all attributes from project but the "_id"
  // Add the project "_id" in a new attribute called "identifier"
  const output = omit(project, ['_id']);
  output.identifier = project._id;
  // If the project has files then, in each file, remove the "_id", the "chunkSize" and the "uploadDate" attributes
  if (project.files) {
    output.files = project.files.map(file =>
      omit(file, ['_id', 'chunkSize', 'uploadDate']),
    );
  }

  return output;
};

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

// Try to parse JSON and return the bad request error in case it fails
const parseJSON = string => {
  try {
    const parse = JSON.parse(string);
    if (parse && typeof parse === 'object') return parse;
  } catch (e) {
    return false;
  }
};

// Escape all regex sensible characters
const escapeRegExp = input => {
  return input.replace(/[-[/\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

(async () => {
  const client = await dbConnection; // Save the mongo database connection
  const db = client.db(process.env.DB_NAME); // Access the database
  const model = {
    // Get the desried collections from the database
    projects: db.collection('projects'),
    analyses: db.collection('analyses'),
    chains: db.collection('chains'),
    references: db.collection('references'),
    topologies: db.collection('topologies'),
  };

  // Root
  projectRouter.route('/').get(
    handler({
      async retriever(request) {
        // Set an object with all the parameters to performe the mongo query
        // Start filtering by published projects only if we are in production environment
        const finder = { ...publishedFilter };
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
                {
                  'metadata.DESCRIPTION': {
                    $regex: tsearch,
                    $options: 'i',
                  },
                },
                {
                  'metadata.AUTHORS': { $regex: tsearch, $options: 'i' },
                },
                { 'metadata.GROUPS': { $regex: tsearch, $options: 'i' } },
                { 'pdbInfo._id': { $regex: tsearch, $options: 'i' } },
                {
                  'pdbInfo.compound': { $regex: tsearch, $options: 'i' },
                },
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
            // Parse the string into a json object
            const objectQuery = parseJSON(q);
            if (!objectQuery) return { error: BAD_REQUEST };
            // At this point the query object should correspond to a mongo query itself
            if (!finder.$and) finder.$and = [];
            finder.$and.push(objectQuery);
          }
        }
        // Set the projection object for the mongo query
        const projector = {};
        // Handle when it is a mongo projection itself
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

        // 3 variables are declared at the same time
        const [filteredCount, projects] = await Promise.all([
          // filteredCount
          // WARNING: We must count before the limit or the count will be affected
          // WARNING: This was not like this in mongodb 3.3, but it changed when updated to mongodb 4.5
          cursor.count(),
          // totalCount
          // DANI: Esto he decidido quiatlo ya que en principio no se usa
          //model.projects.find(publishedFilter).count(),
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
                .map(projectObjectCleaner)
                // Changes the type from Cursor into Array, then saving data in memory
                .toArray()
            : [],
        ]);
        return { filteredCount, projects };
      },
      // If there is not filteredCount (the search was not sucessful), a NO_CONTENT status is sent in the header
      headers(response, { error, filteredCount }) {
        if (error) {
          response.status(error);
          return;
        }
        if (!filteredCount) response.status(NO_CONTENT);
      },
      // Else, the projects list and the two counts are sent in the body
      body(response, retrieved) {
        // 'response.json' sends data in json format and ends the response
        if (retrieved.filteredCount) response.json(retrieved);
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
      retriever(request) {
        // Return the project which matches the request porject ID (accession)
        return model.projects.findOne(
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
        );
      },
      // If no project is found, a NOT_FOUND status is sent in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // Else, the project object is cleaned (some attributes are renamed or removed) and sent in the body
      body(response, retrieved) {
        if (retrieved) response.json(projectObjectCleaner(retrieved));
        else response.end();
      },
    }),
  );

  // Children routes (e.g. .../projects/MCNS00001/files)

  // Files
  projectRouter.use('/:project/files', require('./files')(db, model));
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
})();

module.exports = projectRouter;
