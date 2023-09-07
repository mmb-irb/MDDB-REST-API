const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Mongo DB filter that only returns published results when the environment is set as "production"
const getBaseFilter = require('../../../utils/base-filter');

const analysisRouter = Router({ mergeParams: true });

// This endpoint returns some options of data contained in the projects collection
module.exports = (_, { projects, references }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Get the requested projection
        let projection = request.query.projection;
        if (!projection) return { error: 'Missing projection' };
        if (typeof projection === 'string') projection = [projection];
        // Set the projection object for the mongo query
        const projector = { _id: false, uniprot: true };
        projection.forEach(p => (projector[p] = true));
        // Set the options object to be returned
        // Then all mined data will be written into it
        const options = {};
        // Options may be querying the projects collection (default) or the references collection
        // If the 'ref' flag is passed (even empty) then do the query against references
        if (request.query.ref !== undefined) {
          // Get all project references to be used further
          const projectsCursor = await projects.find(
            getBaseFilter(request),
            // Discard the heaviest fields we do not need anyway
            { projection: { 'metadata.REFERENCES': true, _id: false } },
          );
          // Consume the projects cursor and keep only the references
          const projectReferences = await projectsCursor
            .map(project => project.metadata.REFERENCES)
            .toArray();
          // Get all references
          const referencesCursor = await references.find(
            getBaseFilter(request),
            // Discard the heaviest fields we do not need anyway
            { projection: projector },
          );
          // Consume the references cursor
          const data = await referencesCursor.toArray();
          // For each projected field, get the different available values and the uniprot ids of references which contain them
          projection.forEach(field => {
            const values = {};
            // Set a function to mine values
            const getValues = (object, steps, uniprot_id) => {
              let value = object;
              for (const [index, step] of steps.entries()) {
                // Get the actual value
                value = value[step];
                if (value === undefined) return;
                // In case it is an array search for the remaining steps on each element
                if (Array.isArray(value)) {
                  const remainingSteps = steps.slice(index + 1);
                  value.forEach(element =>
                    getValues(element, remainingSteps, uniprot_id),
                  );
                  return;
                }
              }
              // If the value exists and it is not an array then add it to the list
              // First create an empty list in case this is the first time we find this value
              if (!values[value]) values[value] = [];
              // Then add the uniprot id to the list
              values[value].push(uniprot_id);
            };
            // Run the actual values mining
            const fieldSteps = field.split('.');
            data.forEach(reference =>
              getValues(reference, fieldSteps, reference.uniprot),
            );
            // Now, for each value, convert the uniprot ids list in the count of projects including any of these uniprot ids
            const counts = {};
            Object.entries(values).forEach(([value, uniprot_ids]) => {
              let count = 0;
              for (const references of projectReferences) {
                if (references === null) continue;
                if (
                  references.some(reference => uniprot_ids.includes(reference))
                )
                  count += 1;
              }
              counts[value] = count;
            });
            // Add current field counts to the options object to be returned
            options[field] = counts;
          });
          return options;
        }
        // In case we are querying the projects collection
        // Get all projects
        const cursor = await projects.find(
          getBaseFilter(request),
          // Discard the heaviest fields we do not need anyway
          { projection: projector },
        );
        // Consume the cursor
        const data = await cursor.toArray();
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
