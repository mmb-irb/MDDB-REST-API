const Router = require('express').Router;
const handler = require('../../../utils/generic-handler');

// Get an automatic mongo query parser based on environment and request
const { getProjectQuery } = require('../../../utils/get-project-query');

// Get auxiliar functions
const { getValueGetter } = require('../../../utils/auxiliar-functions');

const { NOT_FOUND } = require('../../../utils/status-codes');

// Import references configuration
const { REFERENCES } = require('../../../utils/constants');

const referenceRouter = Router({ mergeParams: true });

module.exports = (_, model) => {
  // Root
  referenceRouter.route('/').get(
    handler({
      async retriever(request) {
        // Set the projector
        const projector = { _id: false };
        // Project every reference ids filed
        Object.values(REFERENCES).forEach(reference => {
          projector[reference.projectIdsField] = true
        });
        // Return the project which matches the request accession
        const projectData = await model.projects.findOne(
          getProjectQuery(request),
          // But return only the "analyses" attribute
          { projection: projector },
        );
        // If there is nothing retrieved or the retrieved has no metadata then stop here
        if (!(projectData && projectData.metadata)) return {
          headerError: NOT_FOUND,
          error: `Project not found`
        };
        // Set an array with all references
        let allReferences = [];
        // Get the project references
        for await (const [referenceName, reference] of Object.entries(REFERENCES)) {
          const valueGetter = getValueGetter(reference.projectIdsField);
          const projectReferenceIds = valueGetter(projectData);
          // If there are no references then send an empty list
          if (!projectReferenceIds || projectReferenceIds.length == 0) continue;
          // Set up the db query with all reference ids
          const queries = projectReferenceIds.map(referenceId => {
            return { [reference.idField]: referenceId };
          });
          // Otherwise, find the corresponding references in the database and send their data
          const cursor = await model[referenceName].find(
            { $or: queries },
            // But do not return the _id
            { projection: { _id: false } },
          );
          const referencesData = await cursor.toArray();
          allReferences = allReferences.concat(referencesData)
        }
        return allReferences;
      },
      headers(response, retrieved) {
        // There should always be a retrieved object
        if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
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

  return referenceRouter;
};
