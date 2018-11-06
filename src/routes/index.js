const rootRouter = require('express').Router();

rootRouter.route('/').get((req, res) => {
  res.json({ endpoints: ['project'] });
});

rootRouter.use('/project', require('./project'));

module.exports = rootRouter;
