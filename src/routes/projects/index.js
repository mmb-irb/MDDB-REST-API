const Router = require('express').Router;
const omit = require('lodash').omit;

const dbConnection = require('../../models/index');
const handler = require('../../utils/generic-handler');
const publishedFilter = require('../../utils/published-filter');
const augmentFilterWithIDOrAccession = require('../../utils/augment-filter-with-id-or-accession');

const { NO_CONTENT, NOT_FOUND } = require('../../utils/status-codes');

const projectRouter = Router();

const projectObjectCleaner = project => ({
  ...omit(project, ['_id']),
  identifier: project._id,
  pdbInfo: project.pdbInfo
    ? {
        identifier: project.pdbInfo._id,
        ...omit(project.pdbInfo, ['_id']),
      }
    : {},
  files: (project.files || []).map(file =>
    omit(file, ['_id', 'chunkSize', 'uploadDate']),
  ),
});

const filterAndSort = ({ projects }, search = '') => {
  let $search = search.trim();
  if (!$search) return projects.find(publishedFilter);
  if (!isNaN(+$search)) $search += ` MCNS${$search.padStart(5, '0')}`;
  const score = { score: { $meta: 'textScore' } };
  return projects
    .find({ ...publishedFilter, $text: { $search } }, score)
    .project(score)
    .sort(score);
};

(async () => {
  const client = await dbConnection;
  const db = client.db(process.env.DB_NAME);
  const model = {
    projects: db.collection('projects'),
    analyses: db.collection('analyses'),
    chains: db.collection('chains'),
  };

  // root
  projectRouter.route('/').get(
    handler({
      async retriever(request) {
        const cursor = filterAndSort(model, request.query.search);
        const [projects, filteredCount, totalCount] = await Promise.all([
          // filtered list
          request.query.limit
            ? cursor
                // sort
                .sort({ accession: 1 })
                // pagination
                .skip(request.skip)
                .limit(request.query.limit)
                // transform document for public output
                .map(projectObjectCleaner)
                .toArray()
            : [],
          // filtered count
          cursor.count(),
          // total count
          model.projects.find(publishedFilter).count(),
        ]);
        return { projects, filteredCount, totalCount };
      },
      headers(response, { filteredCount }) {
        if (!filteredCount) response.status(NO_CONTENT);
      },
      body(response, retrieved) {
        if (retrieved.filteredCount) response.json(retrieved);
      },
    }),
  );

  // project
  projectRouter.route('/:project').get(
    handler({
      retriever(request) {
        return model.projects.findOne(
          augmentFilterWithIDOrAccession(
            publishedFilter,
            request.params.project,
          ),
        );
      },
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      body(response, retrieved) {
        if (retrieved) response.json(projectObjectCleaner(retrieved));
      },
    }),
  );

  // children routes
  // files
  projectRouter.use('/:project/files', require('./files')(db, model));
  // chains
  projectRouter.use('/:project/chains', require('./chains')(db, model));
  // analyses
  projectRouter.use('/:project/analyses', require('./analyses')(db, model));
})();

module.exports = projectRouter;
