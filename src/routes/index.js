const rootRouter = require('express').Router();
// Configuration parameters getter
const { getConfig } = require('../utils/auxiliar-functions');

rootRouter.route('/').get((request, response) => {
  // List all possible routes
  // This is just a map so the user knows which options are available
  const availableRoutes = ['projects', 'references', 'pointers', 'knowledge'];
  // Find out if the request host is configured as global
  const config = getConfig(request);
  const isGlobal = config && config.global;
  // If so then add the 'nodes' route
  if (isGlobal) availableRoutes.push('nodes');
  // Return the available routes
  response.json({ endpoints: availableRoutes });
});

// Set the real routes
rootRouter.use('/projects', require('./projects'));
rootRouter.use('/references', require('./references'));
rootRouter.use('/pointers', require('./pointers'));
rootRouter.use('/nodes', require('./nodes'));
rootRouter.use('/knowledge', require('./knowledge'));

module.exports = rootRouter;
