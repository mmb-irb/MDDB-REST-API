const Router = require('express').Router;
const dbConnection = require('../../models/index');
const ObjectId = require('mongodb').ObjectId;

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

  projectRouter.route('/').get(async (request, response) => {
    const cursor = model.find();
    const [projects, count] = await Promise.all([
      cursor
        // pagination
        .skip(request.skip)
        .limit(request.query.limit)
        .map(({ _id }) => _id)
        .toArray(),
      cursor.count(),
    ]);
    if (!count) response.status(NO_CONTENT);
    response.json({ projects, count });
  });

  projectRouter.route('/:project').get(async (request, response) => {
    const project = await model.findOne(ObjectId(request.params.project));
    if (!project) return response.sendStatus(NOT_FOUND);
    response.json(project);
  });

  projectRouter.use(
    '/:project/file',
    (request, response, next) => {
      response.locals.project = request.params.project;
      next();
    },
    require('./file')(db, model),
  );
})();

module.exports = projectRouter;
