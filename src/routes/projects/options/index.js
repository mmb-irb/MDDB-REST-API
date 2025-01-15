const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { BAD_REQUEST } = require('../../../utils/status-codes');
// Set a error-proof JSON parser
const { parseJSON, getValueGetter } = require('../../../utils/auxiliar-functions');
// Import references configuration
const { REFERENCES, REFERENCE_HEADER } = require('../../../utils/constants');

const router = Router({ mergeParams: true });

// Root
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Set an object with all the parameters to performe the mongo query
      // Start filtering by published projects only if we are in production environment
      const finder = database.getBaseFilter();
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
          // These fields are actually intended to query references collections
          // If we found references fields then we must query the references collection
          // Then each references field will be replaced by its corresponding project field in a new query
          // e.g. references.proteins -> metadata.REFERENCES
          // e.g. references.ligands -> metadata.LIGANDS
          const parseReferencesQuery = async originalQuery => {
            // Iterate over the original query fields
            for (const [field, value] of Object.entries(originalQuery)) {
              // If the field is actually a list of fields then run the parsing function recursively
              if (field === '$and' || field === '$or') {
                for (const subquery of value) {
                  await parseReferencesQuery(subquery);
                }
                return;
              }
              // If the field does not start with the references header then skip it
              if (!field.startsWith(REFERENCE_HEADER)) return;
              // Get the name of the field and the reference collection
              const fieldSplits = field.split('.');
              const referenceName = fieldSplits[1];
              const referenceField = fieldSplits[2];
              // Get the reference configuration
              const reference = REFERENCES[referenceName];
              // Set the references query
              const referencesQuery = {};
              referencesQuery[referenceField] = value;
              // Set the reference projector
              const referencesProjector = { _id: false };
              referencesProjector[reference.idField] = true;
              // Query the references collection
              // WARNING: If the query is wrong it will not make the code fail until the cursor in consumed
              const referencesCursor = await database[referenceName]
                .find(referencesQuery)
                .project(referencesProjector);
              const results = await referencesCursor
                .map(ref => ref[reference.idField])
                .toArray();
              // Update the original query by removing the original field and adding the parsed one
              delete originalQuery[field];
              originalQuery[reference.projectIdsField] = { $in: results };
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
      const requestedProjections = { projects: [] };
      const availableReferences = Object.keys(REFERENCES);
      availableReferences.forEach(referenceName => { requestedProjections[referenceName] = [] });
      // Keep a set with the references included in the projection
      const requestedReferences = new Set();
      // First separate reference fields from project fields
      for (const field of projection) {
        // If this field has not the reference header then it is a project field
        if (!field.startsWith(REFERENCE_HEADER)) {
          requestedProjections.projects.push(field);
          continue;
        }
        // Otherwise it is a reference field
        // Find the reference it belongs to
        const requestedReference = field.split('.')[1];
        // Make sure the reference exists
        if (!availableReferences.includes(requestedReference)) return {
          headerError: BAD_REQUEST,
          error: `Unknown reference "${requestedReference}". Available references: ${availableReferences.join(', ')}`
        };
        // Add the requetsed reference to the set
        requestedReferences.add(requestedReference);
        // Add the requested field to its corresponding reference
        requestedProjections[requestedReference].push(field);
      }
      // First of all make the projects request
      // This requests has 2 goals
      // First, we get the project requested fields
      // Second, we get reference id fields to further count the number of mathces per reference requested field
      // Set the projector according to the two previously explained goals
      const projector = { _id: false };
      // Add requested project fields
      requestedProjections.projects.forEach(field => {
        projector[field] = true
      });
      // Add requested references id fields
      requestedReferences.forEach(referenceName => {
        const reference = REFERENCES[referenceName];
        projector[reference.projectIdsField] = true;
      })
      // Set the projects cursor
      const projectsCursor = await database.projects.find(finder, { projection: projector });
      // Consume the projects cursor
      const projectsData = await projectsCursor.toArray();
      // Start handling references options
      // First of all, make sure there was at least one reference projection request
      const anyReferenceProjectionRequest = requestedReferences.size > 0;
      if (anyReferenceProjectionRequest) {
        // Now iterate along the different references
        for await (const referenceName of requestedReferences) {
          // Get the reference configuration
          const reference = REFERENCES[referenceName];
          // Set a getter function for the project reference ids field
          const projectIdsGetter = getValueGetter(reference.projectIdsField);
          // Count the number of reference ids per project
          const referenceIdCounts = {};
          for (const projectData of projectsData) {
            const projectReferenceIds = projectIdsGetter(projectData, reference.projectIdsField); 
            if (!projectReferenceIds) continue;
            projectReferenceIds.forEach(referenceId => {
              if (referenceId in referenceIdCounts) referenceIdCounts[referenceId] += 1;
              else referenceIdCounts[referenceId] = 1;
            });
          }
          // Get the requested projection fields for the curent reference
          // Remove both the reference header and the reference name from every field to get the actual fields
          // e.g. 'references.proteins.name' -> 'name'
          const referenceRequestedProjections = requestedProjections[referenceName].map(
            field => field.split('.').slice(2).join('.')
          );
          // Set the references projector
          const referencesProjector = { _id: false };
          // Get reference ids to associate values further
          referencesProjector[reference.idField] = true;
          // Get every requested projection field
          referenceRequestedProjections.forEach(field => {
            referencesProjector[field] = true;
          });
          // Get all references using the custom projector
          const collection = database[referenceName];
          const referencesCursor = await collection.find(
            {}, // Get all references, independently from the request origin
            // Discard the heaviest fields we do not need anyway
            { projection: referencesProjector },
          );
          // Consume the references cursor
          const referencesData = await referencesCursor.toArray();
          // Now for each field, get the different available values and the reference ids on each value
          // Then count how many times any of those reference ids is in the project references list
          referenceRequestedProjections.forEach(field => {
            const referenceIdsPerValue = {};
            // Set a function to mine values
            const getValues = (object, steps, referenceId) => {
              let value = object;
              for (const [index, step] of steps.entries()) {
                // Get the actual value
                value = value[step];
                if (value === undefined) return;
                // In case it is an array search for the remaining steps on each element
                if (Array.isArray(value)) {
                  const remainingSteps = steps.slice(index + 1);
                  value.forEach(element =>
                    getValues(element, remainingSteps, referenceId),
                  );
                  return;
                }
              }
              // If the value exists and it is not an array then add it to the list
              // First create an empty list in case this is the first time we find this value
              if (!referenceIdsPerValue[value]) referenceIdsPerValue[value] = [];
              // Then add the reference id to the list
              referenceIdsPerValue[value].push(referenceId);
            };
            // Run the actual values mining
            const fieldSteps = field.split('.');
            referencesData.forEach(referenceData => {
              const referenceId = referenceData[reference.idField];
              // If the reference id is not among the project counts then skip it
              // There will be no matches from it anyway
              // This may happen when we do not target the whole database
              if (!(referenceId in referenceIdCounts)) return;
              getValues(referenceData, fieldSteps, referenceData[reference.idField])
            });
            // Convert every reference ids list in the count of projects including any of these reference ids
            const valueCounts = {};
            Object.entries(referenceIdsPerValue).forEach(([value, referenceIds]) => {
              const count = referenceIds.reduce((acc, curr) => acc + (referenceIdCounts[curr] || 0), 0);
              // Add the count only if it is not 0
              // This may happen when a reference is orphan (i.e. its associated projects were deleted)
              if (count !== 0) valueCounts[value] = count;
            });
            // Add current value counts to the options object to be returned
            const originalFieldName = `${REFERENCE_HEADER}${referenceName}.${field}`;
            options[originalFieldName] = valueCounts;
          });
        }
      }
      // Now handle project options
      if (requestedProjections.projects.length !== 0) {
        // For each projected field, get the counts
        requestedProjections.projects.forEach(field => {
          // For each different value, save all project "indices" including it
          // This allows us to not count the same project twice
          // However we do not care which project has it, so we do not use the project id or similar
          const values = {};
          // Set a recursive function to reach indented values
          const getValues = (object, steps, projectIndex) => {
            let value = object;
            for (const [index, step] of steps.entries()) {
              value = value[step];
              if (value === undefined) return;
              // In case it is an array search for the remaining steps on each element
              if (Array.isArray(value)) {
                const remainingSteps = steps.slice(index + 1);
                value.forEach(element => getValues(element, remainingSteps, projectIndex));
                return;
              }
            }
            // Get the set of projects with the current value and update it
            const currentValueProjects = values[value];
            if (currentValueProjects) currentValueProjects.add(projectIndex);
            else values[value] = new Set([ projectIndex ]);
          };
          // Start the recursive function here
          const fieldSteps = field.split('.');
          projectsData.forEach((projectData, projectIndex) => getValues(projectData, fieldSteps, projectIndex));
          // Count how many times is repeated each value and save the number with the fieldname key
          const counts = {};
          Object.entries(values).forEach(([value, projectIndices]) => { counts[value] = projectIndices.size });
          // Add current field counts to the overall options object to be returned
          options[field] = counts;
        });
      }
      // Send all mined data
      return options;
    }
  }),
);

module.exports = router;