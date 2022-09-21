const rootRouter = require('express').Router();

rootRouter.route('/').get((_, res) => {
  // Return an object with all possible routes
  // This is just a map so the API user know which options are available
  res.json({ endpoints: ['projects'] });
});

// Set the real routes
rootRouter.use('/projects', require('./projects'));
rootRouter.use('/references', require('./references'));

module.exports = rootRouter;
