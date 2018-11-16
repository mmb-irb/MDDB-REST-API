const rootRouter = require('express').Router();

rootRouter.route('/').get((req, res) => {
  res.json({ endpoints: ['projects'] });
});

rootRouter.use('/projects', require('./projects'));

module.exports = rootRouter;
