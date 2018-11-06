const Router = require('express').Router;
const dbConnection = require('../../models/index');

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
  const model = client.db(mongoConfig.db).collection('projects');

  projectRouter.route('/').get(async (req, res) => {
    const cursor = model.find({}, { projection: { id: true } });
    const [projects, count] = await Promise.all([
      cursor
        .skip(req.skip)
        .limit(req.query.limit)
        .map(({ id }) => id)
        .toArray(),
      cursor.count(),
    ]);
    if (!count) res.status(NO_CONTENT);
    res.json({ projects, count });
  });

  projectRouter.route('/:project').get(async (req, res) => {
    const project = await model.findOne(
      { id: req.params.project },
      { projection: { _id: false } },
    );
    if (!project) res.sendStatus(NOT_FOUND);
    res.json(project);
  });
})();

module.exports = projectRouter;
