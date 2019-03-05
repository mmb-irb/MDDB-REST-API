const rootRouter = require('express').Router();

rootRouter.route('/').get((_, res) => {
  res.json({ endpoints: ['projects'] });
});

rootRouter.use('/projects', require('./projects'));

module.exports = rootRouter;
