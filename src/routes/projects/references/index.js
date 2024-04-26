const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Get auxiliar functions
const { getValueGetter } = require('../../../utils/auxiliar-functions');
// Import references configuration
const { REFERENCES } = require('../../../utils/constants');

const router = Router({ mergeParams: true });

// Root
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Set the projector
      const projector = { _id: false };
      // Project every reference ids filed
      Object.values(REFERENCES).forEach(reference => {
        projector[reference.projectIdsField] = true
      });
      // Get the requested project data
      const projectData = await database.getRawProjectData(projection = projector);
       // If something went wrong while requesting project data then stop here
       if (projectData.error) return projectData;
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
        const cursor = await database[referenceName].find(
          { $or: queries },
          // But do not return the _id
          { projection: { _id: false } },
        );
        const referencesData = await cursor.toArray();
        allReferences = allReferences.concat(referencesData)
      }
      return allReferences;
    }
  }),
);

module.exports = router;