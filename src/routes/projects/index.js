const Router = require('express').Router;
// This function returns an object without the selected omitted attributes
const omit = require('lodash').omit;
// Connect to the mongo database and return this connexion
const dbConnection = require('../../models/index');
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
  if(project.pdbInfo){
    output.pdbInfo = {...omit(project.pdbInfo, ['_id'])};
    output.pdbInfo.identifier = project.pdbInfo._id;
  }
  // If the project has files then, in each file, remove the "_id", the "chunkSize" and the "uploadDate" attributes
  output.files = [];
  if (project.files) {
    output.files = project.files.map(file =>
      omit(file, ['_id', 'chunkSize', 'uploadDate']),
    )
  }

  return output;
};

// Returns "projects", which is a "Cursor" type variable (from mongo)
// Filters by "published" projects when we are in production environment
// Filters by user search when provided
const filterAndSort = ({ projects }, search = '') => {
  let $search = search.trim(); // trim() removes surrounding white spaces
  // If there is no search we just performe the first filter and return the cursor
  if (!$search) return projects.find(publishedFilter);
  // Else, $search is transformed into a mongo DB accepted format
  // padStart() adds 0s by the left side to $search until until it is 5 characters long
  if (!isNaN(+$search)) $search += ` MCNS${$search.padStart(5, '0')}`;
  // Returns the cursor filtering by "published" projects and the $search sorted by score
  // The "score" refers to how similar is the result to the provided search terms (the string)
  // This is a standarized protocol in mongo to sort ".find" results according to their score
  const score = { score: { $meta: 'textScore' } };
  return projects
    .find({ ...publishedFilter, $text: { $search } }, score)
    .project(score)
    .sort(score);
};

(async () => {
  const client = await dbConnection; // Save the mongo database connection
  const db = client.db(process.env.DB_NAME); // Access the database
  const model = { // Get the desried collections from the database
    projects: db.collection('projects'),
    analyses: db.collection('analyses'),
    chains: db.collection('chains'),
  };

  // Root
  projectRouter.route('/').get(
    handler({
      async retriever(request) {
        const cursor = filterAndSort(model, request.query.search);
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
        if (retrieved.filteredCount) response.json(retrieved);
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
