const Router = require('express').Router;
const omit = require('lodash').omit;

const dbConnection = require('../../models/index');
const storeParameterMiddleware = require('../../utils/store-parameter-middleware');
const handler = require('../../utils/generic-handler');

const { NO_CONTENT, NOT_FOUND } = require('../../utils/status-codes');

const projectRouter = Router();

const projectObjectCleaner = project => ({
  identifier: project._id,
  metadata: project.metadata,
  analyses: project.analyses || [],
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
  let mongoConfig;
  try {
    // mongo config file, can be json or js code
    mongoConfig = require('../../../configs/mongo');
  } catch (_) {
    console.error("couldn't find mongo config file");
    return;
  }
  const client = await dbConnection;
  const db = client.db(mongoConfig.db);
  const model = {
    projects: db.collection('projects'),
    analyses: db.collection('analyses'),
  };

  const filterAndSort = ({ projects }, search = '') => {
    let $search = search.trim();
    if (!$search) return projects.find();
    if (!isNaN(+$search)) $search += ` MCNS${$search.padStart(5, '0')}`;
    const score = { score: { $meta: 'textScore' } };
    return projects
      .find({ $text: { $search } }, score)
      .project(score)
      .sort(score);
  };

  // root
  const rootRetriever = request => {
    const cursor = filterAndSort(model, request.query.search);
    return Promise.all([
      cursor
        // pagination
        .skip(request.skip)
        .limit(request.query.limit)
        // transform document for public output
        .map(projectObjectCleaner)
        .toArray(),
      cursor.count(),
      model.projects.find().count(),
    ]);
  };

  const rootSerializer = (response, [projects, filteredCount, totalCount]) => {
    if (!filteredCount) response.status(NO_CONTENT);
    response.json({ projects, filteredCount, totalCount });
  };

  // project
  const projectRetriever = request =>
    model.projects.findOne({ _id: request.params.project });

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
    '/:project/analyses',
    storeProjectMiddleware,
    require('./analyses')(db, model),
  );
})();

module.exports = projectRouter;
