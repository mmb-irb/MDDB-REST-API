const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Mongo DB filter that only returns published results when the environment is set as "production"
const publishedFilter = require('../../../utils/published-filter');

const analysisRouter = Router({ mergeParams: true });

// Get the count of identical elements in an array
const getCounts = (array, counter) => {
  array.forEach(e => (counter[e] = (counter[e] || 0) + 1));
};

// This endpoint returns some options of data contained in the projects collection
module.exports = (_, { projects }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Get the requested projection
        let projection = request.query.projection;
        if (!projection) return { error: 'Missing projection' };
        if (typeof projection === 'string') projection = [projection];
        // Set the projection object for the mongo query
        const projector = {};
        projection.forEach(p => (projector[p] = true));
        // Get all projects
        const cursor = await projects.find(
          publishedFilter,
          // Discard the heaviest fields we do not need anyway
          { projection: projector },
        );
        // Consume the cursor
        const data = await cursor.toArray();
        // Set the options object to be returned
        // Then all mined data will be written into it
        const options = {};
        // For each projected field, get the counts
        projection.forEach(field => {
          const values = [];
          const getValues = (object, steps) => {
            let value = object;
            for (const [index, step] of steps.entries()) {
              value = value[step];
              if (value === undefined) return;
              // In case it is an array search for the remaining steps on each element
              if (Array.isArray(value)) {
                const remainingSteps = steps.slice(index + 1);
                value.forEach(element => getValues(element, remainingSteps));
                return;
              }
            }
            values.push(value);
          };
          const fieldSteps = field.split('.');
          data.forEach(project => getValues(project, fieldSteps));
          // Count how many times is repeated each value and save the number with the fieldname key
          const counts = {};
          values.forEach(v => (counts[v] = (counts[v] || 0) + 1));
          options[field] = counts;
        });

        // Get the count of each 'unit' in all simulations
        // const units = data.map(object => object.metadata.UNIT);
        // getCounts(units, options);
        // Send all mined data
        return options;
      },
      // If there is nothing retrieved send a INTERNAL_SERVER_ERROR status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(INTERNAL_SERVER_ERROR);
      },
      // If there is retrieved and the retrieved then send it
      body(response, retrieved) {
        if (!retrieved) response.end();
        response.json(retrieved);
      },
    }),
  );

  return analysisRouter;
};
