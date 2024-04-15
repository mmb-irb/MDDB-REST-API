const rootRouter = require('express').Router();

rootRouter.route('/').get((_, res) => {
  // Return an object with all possible routes
  // This is just a map so the API user know which options are available
  res.json({ endpoints: ['proteins', 'ligands'] });
});

// Set the reference routes
rootRouter.use('/proteins', require('./proteins'));
rootRouter.use('/ligands', require('./ligands'));

module.exports = rootRouter;
