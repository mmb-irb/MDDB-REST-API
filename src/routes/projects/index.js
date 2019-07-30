const Router = require('express').Router;
const omit = require('lodash').omit;

const dbConnection = require('../../models/index');
const storeParameterMiddleware = require('../../utils/store-parameter-middleware');
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

(async () => {
  const client = await dbConnection;
  const db = client.db(process.env.DB_NAME);
  const model = {
    projects: db.collection('projects'),
    analyses: db.collection('analyses'),
    chains: db.collection('chains'),
  };

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

  // root
  const rootRetriever = request => {
    const cursor = filterAndSort(model, request.query.search);
    return Promise.all([
      // filtered list
      cursor
        // sort
        .sort({ accession: 1 })
        // pagination
        .skip(request.skip)
        .limit(request.query.limit)
        // transform document for public output
        .map(projectObjectCleaner)
        .toArray(),
      // filtered count
      cursor.count(),
      // total count
      model.projects.find(publishedFilter).count(),
    ]);
  };

  const rootSerializer = (response, [projects, filteredCount, totalCount]) => {
    if (!filteredCount) response.status(NO_CONTENT);
    response.json({ projects, filteredCount, totalCount });
  };

  // project
  const projectRetriever = request =>
    model.projects.findOne(
      augmentFilterWithIDOrAccession(publishedFilter, request.params.project),
    );

  const projectSerializer = (response, project) => {
    if (!project) return response.sendStatus(NOT_FOUND);
    response.json(projectObjectCleaner(project));
  };

  // handlers
  projectRouter.route('/').get(handler(rootRetriever, rootSerializer));

  projectRouter
    .route('/:project')
    .get(handler(projectRetriever, projectSerializer));

  // pass on to other handlers
  const storeProjectMiddleware = storeParameterMiddleware('project');

  projectRouter.use(
    '/:project/files',
    storeProjectMiddleware,
    require('./files')(db, model),
  );

  projectRouter.use(
    '/:project/chains',
    storeProjectMiddleware,
    require('./chains')(db, model),
  );

  projectRouter.use(
    '/:project/analyses',
    storeProjectMiddleware,
    require('./analyses')(db, model),
  );
})();

module.exports = projectRouter;
