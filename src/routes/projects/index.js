const Router = require('express').Router;
const omit = require('lodash').omit;

const dbConnection = require('../../models/index');
const storeParameterMiddleware = require('../../utils/store-parameter-middleware');
const handler = require('../../utils/generic-handler');

const NO_CONTENT = 204;
const NOT_FOUND = 404;

const projectRouter = Router();

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
  const model = db.collection('projects');

  // root
  const rootRetriever = request => {
    const cursor = model.find();
    return Promise.all([
      cursor
        // pagination
        .skip(request.skip)
        .limit(request.query.limit)
        // transform document for public output
        .map(({ _id: identifier, ...rest }) => ({ identifier, ...rest }))
        .toArray(),
      cursor.count(),
    ]);
  };

  const rootSerializer = (response, [projects, count]) => {
    if (!count) response.status(NO_CONTENT);
    response.json({ projects, count });
  };

  // project
  const projectRetriever = request =>
    model.findOne({ _id: request.params.project });

  const projectSerializer = (response, project) => {
    if (!project) return response.sendStatus(NOT_FOUND);
    response.json({
      identifier: project._id,
      metadata: project.metadata,
      analyses: project.analyses || {},
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
