const Router = require('express').Router;
const { ObjectId } = require('mongodb');
// This function returns an object without the selected omitted attributes
const omit = require('lodash').omit;
// Connect to the mongo database and return the connection
const dbConnection = require('../../models/index');
// Alternatively, connect to a local fake mongo database and return the connection
//const dbConnection = require('../../../test-helpers/mongo/index');
const handler = require('../../utils/generic-handler');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../utils/published-filter');
// Adds the project associated ID from mongo db to the provided object
const augmentFilterWithIDOrAccession = require('../../utils/augment-filter-with-id-or-accession');

const { NO_CONTENT, NOT_FOUND } = require('../../utils/status-codes');

const projectRouter = Router();

// This function renames the "_id" attributes from the project and from their pdbInfo attribute as "identifier"
// In addition, it removes the "_id" and other 2 attributes from the files
const projectObjectCleaner = project => {
  // Add all attributes from project but the "_id"
  // Add the project "_id" in a new attribute called "identifier"
  const output = omit(project, ['_id']);
  output.identifier = project._id;
  // Add the attribute "pdbInfo". If the project has not a pdbInfo attribute then leave it empty
  // If the project has a pdbInfo attribute then add all its attributes to the new pdbInfo
  // Again, the "_id" attribute is first omited and then added as a new attribute called "identifier"
  output.pdbInfo = {};
  if (project.pdbInfo) {
    output.pdbInfo = { ...omit(project.pdbInfo, ['_id']) };
    output.pdbInfo.identifier = project.pdbInfo._id;
  }
  // If the project has files then, in each file, remove the "_id", the "chunkSize" and the "uploadDate" attributes
  output.files = [];
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

(async () => {
  const client = await dbConnection; // Save the mongo database connection
  const db = client.db(process.env.DB_NAME); // Access the database
  const model = {
    // Get the desried collections from the database
    projects: db.collection('projects'),
    analyses: db.collection('analyses'),
    chains: db.collection('chains'),
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
          // $regex is a mongo command to search for regular expressions inside fields
          // trim() removes surrounding white spaces
          // $options: 'i' stands for the search to be case insensitive
          finder.$and = [
            {
              $or: [
                { accession: { $regex: search.trim(), $options: 'i' } },
                { 'metadata.NAME': { $regex: search.trim(), $options: 'i' } },
                {
                  'metadata.DESCRIPTION': {
                    $regex: search.trim(),
                    $options: 'i',
                  },
                },
                { 'pdbInfo._id': { $regex: search.trim(), $options: 'i' } },
                {
                  'pdbInfo.compound': { $regex: search.trim(), $options: 'i' },
                },
              ],
            },
          ];
        }
        // Then, filter by 'filter' parameters
        // Look for a specified value in any database field
        let filter = request.query.filter;
        if (filter) {
          // In case there is a single filter it would be a string, not an array, so transform it
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
        // The "score" refers to how similar is the result to the provided search terms (the string)
        // This is a standarized protocol in mongo to sort ".find" results according to their score
        const score = { score: { $meta: 'textScore' } };
        // Finally, perform the mongo query
        let cursor = await model.projects
          .find(finder, score)
          .project(score)
          .sort(score);
        // If there are no results, we try it with the mongo internal ids
        // This only works with the full object id, not partial ids
        if ((await cursor.count()) === 0 && /[a-z0-9]{24}/.test(search)) {
          const id = ObjectId(search.match(/[a-z0-9]{24}/)[0]);
          cursor = await model.projects.find({ _id: id });
        }
        // If we still having no results, return here
        if (cursor.count() === 0) return;

        // 3 variables are declared at the same time
        const [projects, filteredCount, totalCount] = await Promise.all([
          // If the request (URL) contains a limit query (i.e. ...?limit=x)
          request.query.limit
            ? cursor
                .sort({ accession: 1 }) // We sort again. This time alphabetically by accession (*previous sort may be redundant)
                .skip(request.skip) // Avoid the first results when a page is provided in the request (URL)
                .limit(request.query.limit) // Avoid the last results when a limit is provided in the request query (URL)
                .map(projectObjectCleaner) // Each project is cleaned (some attributes are renamed or removed)
                .toArray() // Changes the type from Cursor into Array, then saving data in memory
            : [],
          // filteredCount
          cursor.count(),
          // totalCount
          model.projects.find(publishedFilter).count(),
        ]);
        return { projects, filteredCount, totalCount };
      },
      // If there is not filteredCount (the search was not sucessful), a NO_CONTENT status is sent in the header
      headers(response, { filteredCount }) {
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
})();

module.exports = projectRouter;
