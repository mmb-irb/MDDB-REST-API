const Router = require('express').Router;
const handler = require('../../../utils/generic-handler');

// Get an automatic mongo query parser based on environment and request
const { getProjectQuery } = require('../../../utils/get-project-query');

const { NOT_FOUND } = require('../../../utils/status-codes');

const referenceRouter = Router({ mergeParams: true });

module.exports = (_, { projects, references }) => {
  // Root
  referenceRouter.route('/').get(
    handler({
      async retriever(request) {
        // Return the project which matches the request accession
        const projectDoc = await projects.findOne(
          getProjectQuery(request),
          // But return only the "analyses" attribute
          { projection: { _id: false, 'metadata.REFERENCES': true } },
        );
        // If there is nothing retrieved or the retrieved has no metadata then stop here
        if (!(projectDoc && projectDoc.metadata)) return;
        // Get the project references
        const projectReferences = projectDoc.metadata.REFERENCES;
        // If there are no references then send an empty list
        if (!projectReferences || projectReferences.length == 0) return [];
        // Set up the db query with all reference uniprots
        const queries = projectReferences.map(reference => {
          return { uniprot: reference };
        });
        // Otherwise, find the corresponding references in the database and send their data
        const cursor = await references.find(
          {
            $or: queries,
          },
          // But do not return the _id
          { projection: { _id: false } },
        );
        const referencesData = await cursor.toArray();
        return referencesData;
      },
      headers(response, retrieved) {
        // If there is nothing retrieved then send a 'NOT_FOUND' header
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      body(response, retrieved) {
        // If there is nothing retrieved then stop here
        if (!retrieved) response.end();
        else response.json(retrieved);
      },
    }),
  );

  return referenceRouter;
};
