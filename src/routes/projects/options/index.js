const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { BAD_REQUEST, NOT_FOUND } = require('../../../utils/status-codes');
// Set a error-proof JSON parser
const { getValueGetter } = require('../../../utils/auxiliar-functions');
// Import references configuration
const { REFERENCES, REFERENCE_HEADER, TOPOLOGY_HEADER } = require('../../../utils/constants');

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
        // Process the mongo query to convert references and topology queries
        const processedQuery = await database.processProjectsQuery(query);
        if (processedQuery.error) return processedQuery;
        if (!finder.$and) finder.$and = processedQuery;
        else finder.$and = finder.$and.concat(processedQuery);
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
      // Options may be fields from projects, topologies, or references collections
      // Fields in references are headed with the 'references.' label and they are handled separately
      // Start with options from references
      // In case there is any reference we must query the projects collections first
      const requestedProjections = { projects: [], topologies: [] };
      const availableReferences = Object.keys(REFERENCES);
      availableReferences.forEach(referenceName => { requestedProjections[referenceName] = [] });
      // Keep a set with the references included in the projection
      const requestedReferences = new Set();
      // First separate reference fields from project fields
      for (const field of projection) {
        // If this field has the topology header then it is a topology field
        if (field.startsWith(TOPOLOGY_HEADER)) {
          requestedProjections.topologies.push(field);
          continue;
        }
        // If this field has not the reference header either then it is a project field
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
        // Make sure there is something after the reference name or we will have a mongo error later
        if (!field.split('.')[2]) return  {
          headerError: BAD_REQUEST,
          error: `Empty reference field in "${field}". Please provide a field name after "${requestedReference}"`
        }
        // Add the requetsed reference to the set
        requestedReferences.add(requestedReference);
        // Add the requested field to its corresponding reference
        requestedProjections[requestedReference].push(field);
      }
      // First of all make the projects request
      // This requests has 2 goals
      // First, we get the project requested fields
      // Second, we get reference id fields to further count the number of matches per reference requested field
      // Set the projector according to the two previously explained goals
      // We will need internal ids if we have to request any topology field
      const anyTopologyProjection = requestedProjections.topologies.length > 0;
      const projector = { _id: anyTopologyProjection };
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
      // If projects data is empty then stop here
      if (projectsData.length === 0) return {
        headerError: NOT_FOUND,
        error: `Query ${query} is empty`
      }
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
            const projectReferenceIds = projectIdsGetter(projectData);
            if (!projectReferenceIds) continue;
            projectReferenceIds.forEach(referenceId => {
              if (referenceId in referenceIdCounts) referenceIdCounts[referenceId] += 1;
              else referenceIdCounts[referenceId] = 1;
            });
          }
          // Get the requested projection fields for the current reference
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
      // Next process topology requests
      if (anyTopologyProjection) {
        // Get internal ids from target projects
        const targetProjectIds = projectsData.map(project => project._id);
        // Set the topologies projector
        const topologyFields = requestedProjections.topologies.map(field => field.split('.')[1]);
        const topologiesProjector = { _id: false };
        topologyFields.forEach(field => { topologiesProjector[field] = true });
        // Get target topologies
        const topologiesCursor = await database.topologies.find(
          { project: { $in: targetProjectIds }},
          // Discard the heaviest fields we do not need anyway
          { projection: topologiesProjector },
        );
        // Now get the count of every different value for every projected field
        const counts = {};
        topologyFields.forEach(field => { counts[field] = {} });
        // If there are many topologies we may exceed the memory limit
        // To avoid this, instead of consuming the whole cursor we will iterate its documents
        for await (const topologyData of topologiesCursor) {
          topologyFields.forEach(field => {
            // Get the unique values in this topology
            const fieldData = topologyData[field];
            if (!fieldData) return;
            const uniqueValues = Array.isArray(fieldData)
              ? new Set(fieldData)
              : new Set(Object.values(fieldData))
            // Get the current counts for this field
            const currentCounts = counts[field];
            // Add one to the counts for every unique value found
            uniqueValues.forEach(value => {
              currentCounts[value] = (currentCounts[value] || 0) + 1
            })
          })
        }
        // Add final counts to the overall options
        // Recover the topology field header now
        Object.entries(counts).forEach(([fieldName, fieldCounts]) => {
          options[TOPOLOGY_HEADER + fieldName] = fieldCounts;
        });
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
      // Sort values by count for every projected field
      Object.entries(options).forEach(([field, counts]) => {
        const sortedCounts = Object.entries(counts)
          .sort(([,a],[,b]) => b-a)
          .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});
        options[field] = sortedCounts;
      });
      // Send all mined data
      return options;
    }
  }),
);

module.exports = router;