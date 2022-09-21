const Router = require('express').Router;
const handler = require('../../utils/generic-handler');

// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection =
  process.env.NODE_ENV === 'test'
    ? require('../../../test-helpers/mongo/index')
    : require('../../models/index');

const { NOT_FOUND } = require('../../utils/status-codes');

const referenceRouter = Router({ mergeParams: true });

// Remove the internal id from
const referenceObjectCleaner = reference => {
  delete reference._id;
  return reference;
};

(async () => {
  const client = await dbConnection; // Save the mongo database connection
  const db = client.db(process.env.DB_NAME); // Access the database
  const references = db.collection('references');

  // Root
  referenceRouter.route('/').get(
    handler({
      async retriever() {
        // Get all references, but only their uniprot ids
        const cursor = await references.find(
          {},
          { projection: { uniprot: true } },
        );
        // Consume the cursor
        const refs = await cursor.toArray();
        // Get the uniprot ids in an array
        const refIds = refs.map(ref => ref.uniprot);
        return refIds;
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

  // When the request (URL) contains a uniprot id
  // e.g. "P0DTC2"
  referenceRouter.route('/:uniprot').get(
    handler({
      async retriever(request) {
        // Return the project which matches the request porject ID (accession)
        const result = await references.findOne({
          uniprot: request.params.uniprot,
        });
        return result;
      },
      // If no project is found, a NOT_FOUND status is sent in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // Else, the project object is cleaned (some attributes are renamed or removed) and sent in the body
      body(response, retrieved) {
        if (retrieved) response.json(referenceObjectCleaner(retrieved));
        else response.end();
      },
    }),
  );
})();

module.exports = referenceRouter;
