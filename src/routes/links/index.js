const rootRouter = require('express').Router();

rootRouter.route('/').get((request, response) => {
  // List all possible routes
  // This is just a map so the user knows which options are available
  const availableRoutes = ['pointers'];
  // Return the available routes
  response.json({ endpoints: availableRoutes });
});

// Set the real routes
rootRouter.use('/pointers', require('./pointers'));

module.exports = rootRouter;
