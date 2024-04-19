const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

// Standard HTTP response status codes
const { BAD_REQUEST, INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const { getBaseFilter } = require('../../../utils/get-project-query');
// Set a error-proof JSON parser
const { parseJSON } = require('../../../utils/auxiliar-functions');

// Set a header for queried fields to be queried in the references collection instead of projects
const referencesHeader = 'references.';

const analysisRouter = Router({ mergeParams: true });


// This endpoint returns some options of data contained in the projects collection
module.exports = (_, { projects, references }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Set an object with all the parameters to performe the mongo query
        // Start filtering by published projects only if we are in production environment
        const finder = getBaseFilter(request);
        // Handle when there is a mongo query
        let query = request.query.query;
        if (query) {
          // In case there is a single query it would be a string, not an array, so adapt it
          if (typeof query === 'string') query = [query];
          for (const q of query) {
            // Parse the string into an object
            const projectsQuery = parseJSON(q);
            if (!projectsQuery) return {
              headerError: BAD_REQUEST,
              error: 'Wrong query syntax: ' + q
            };
            // At this point the query object should correspond to a mongo query itself
            // Find fields which start with 'references'
            // These fields are actually intended to query the references collections
            // If we found references fields then we must query the references collection
            // Then each references field will be replaced by a query to 'metadata.REFERENCES' in the projects query
            // The value of 'metadata.REFERENCES' to be queried will be the matching uniprot ids
            const parseReferencesQuery = async original_query => {
              // Iterate over the original query fields
              for (const [field, value] of Object.entries(original_query)) {
                // If the field is actually a list of fields then run the parsing function recursively
                if (field === '$and' || field === '$or') {
                  for (const subquery of value) {
                    await parseReferencesQuery(subquery);
                  }
                  return;
                }
                // If the field does not start with the references header then skip it
                if (!field.startsWith(referencesHeader)) return;
                // Get the name of the field after substracting the symbolic header
                const referencesField = field.replace(referencesHeader, '');
                const referencesQuery = {};
                referencesQuery[referencesField] = value;
                // Query the references collection
                // WARNING: If the query is wrong it will not make the code fail until the cursor in consumed
                const referencesCursor = await model.references
                  .find(referencesQuery)
                  .project({ uniprot: true, _id: false });
                const results = await referencesCursor
                  .map(ref => ref.uniprot)
                  .toArray();
                // Update the original query by removing the original field and adding the parsed one
                delete original_query[field];
                original_query['metadata.REFERENCES'] = { $in: results };
              }
            };
            // Start the parsing function
            await parseReferencesQuery(projectsQuery);
            if (!finder.$and) finder.$and = [];
            finder.$and.push(projectsQuery);
          }
        }
        // Get the requested projection
        let projection = request.query.projection;
        if (!projection) return {
          headerError: BAD_REQUEST,
          error: 'Missing projection'
        };
        if (typeof projection === 'string') projection = [projection];
        // Set the options object to be returned
        // Then all mined data will be written into it
        const options = {};
        // Options may be fields both from projects or references collections
        // Fields in references are headed with the 'references.' label and they are handled separately
        // Start with options from references
        // In case there is any reference we must query the projects collections first
        // First separate projections according to which collection they are focused in
        // Also remove references headers to match the original field names
        const projectsProjections = [];
        const referencesProjections = [];
        projection.forEach(p => {
          // If there is no header then add it to the projects projections list
          if (!p.startsWith(referencesHeader)) {
            projectsProjections.push(p);
            return;
          }
          // Otherwise remove the header and add it to the references projections list
          const referencesField = p.replace(referencesHeader, '');
          referencesProjections.push(referencesField);
        });
        // Now start handling references options
        if (referencesProjections.length !== 0) {
          // Get all project references to be used further
          const projectsCursor = await projects.find(
            finder,
            // Discard the heaviest fields we do not need anyway
            { projection: { 'metadata.REFERENCES': true, _id: false } },
          );
          // Consume the projects cursor and keep only the references
          const projectReferences = await projectsCursor
            .map(project => project.metadata.REFERENCES || undefined)
            .toArray();
          // Now set the projector with references fields only
          // Get also the uniprot ids to associate values further
          const referencesProjector = { _id: false, uniprot: true };
          referencesProjections.forEach(p => (referencesProjector[p] = true));
          // Get all references using the custom projector
          const referencesCursor = await references.find(
            {}, // Get all references, independently from the request origin
            // Discard the heaviest fields we do not need anyway
            { projection: referencesProjector },
          );
          // Consume the references cursor
          const referencesData = await referencesCursor.toArray();
          // Now for each field, get the different available values and the uniprot ids on each value
          // Then count how many times any of those uniprots is in the project references list
          referencesProjections.forEach(field => {
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
            referencesData.forEach(reference =>
              getValues(reference, fieldSteps, reference.uniprot),
            );
            // Now, for each value, convert the uniprot ids list in the count of projects including any of these uniprot ids
            const counts = {};
            Object.entries(values).forEach(([value, uniprot_ids]) => {
              let count = 0;
              for (const references of projectReferences) {
                if (references === undefined) continue;
                if (
                  references.some(reference => uniprot_ids.includes(reference))
                )
                  count += 1;
              }
              // Add the count only if it is not 0
              // This may happen when a reference is orphan (i.e. its associated projects were deleted)
              if (count !== 0) counts[value] = count;
            });
            // Add current field counts to the options object to be returned
            options[referencesHeader + field] = counts;
          });
        }
        // Now handle references options
        if (projectsProjections.length !== 0) {
          // Set the projection object for the mongo query
          const projector = { _id: false };
          projectsProjections.forEach(p => (projector[p] = true));
          // In case we are querying the projects collection
          // Get all projects
          const cursor = await projects.find(
            finder,
            // Get only the projected values
            { projection: projector },
          );
          // Consume the cursor
          const data = await cursor.toArray();
          // For each projected field, get the counts
          projectsProjections.forEach(field => {
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
        }
        // Send all mined data
        return options;
      },
      // Handle the response header
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
      },
    }),
  );

  return analysisRouter;
};
