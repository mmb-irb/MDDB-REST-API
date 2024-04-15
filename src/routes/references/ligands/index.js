const Router = require('express').Router;
const handler = require('../../../utils/generic-handler');

// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection =
  process.env.NODE_ENV === 'test'
    ? require('../../../../test-helpers/mongo/index')
    : require('../../../models/index');

const { NOT_FOUND } = require('../../../utils/status-codes');

const router = Router({ mergeParams: true });

// Remove the internal id from
const idCleaner = object => {
  delete object._id;
  return object;
};

(async () => {
  const client = await dbConnection; // Save the mongo database connection
  const db = client.db(process.env.DB_NAME); // Access the database
  const ligandReferences = db.collection('ligands');

  // Root
  router.route('/').get(
    handler({
      async retriever() {
        // Get all ligand references, but only their pubchem ids
        const cursor = await ligandReferences.find(
          {},
          { projection: { pubchem: true } },
        );
        // Consume the cursor
        const refs = await cursor.toArray();
        // Get the pubchem ids in an array
        const refIds = refs.map(ref => ref.pubchem);
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

  // When the request (URL) contains a pubchem id
  // e.g. "1986"
  router.route('/:pubchem').get(
    handler({
      async retriever(request) {
        // Return the ligand reference which matches the request pubchem
        const result = await ligandReferences.findOne({
          pubchem: request.params.pubchem,
        });
        return result;
      },
      // If no project is found, a NOT_FOUND status is sent in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // Else, the project object is cleaned (some attributes are renamed or removed) and sent in the body
      body(response, retrieved) {
        if (retrieved) response.json(idCleaner(retrieved));
        else response.end();
      },
    }),
  );
})();

module.exports = router;
