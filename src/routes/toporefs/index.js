const Router = require('express').Router;
// This function returns an object without the selected omitted attributes
const omit = require('lodash').omit;
// Connect to the mongo database and return the connection
// Alternatively, in 'test' context, connect to a local fake mongo database and return the connection
const dbConnection =
  process.env.NODE_ENV === 'test'
    ? require('../../../test-helpers/mongo/index')
    : require('../../models/index');
const handler = require('../../utils/generic-handler');

const { NOT_FOUND } = require('../../utils/status-codes');

const toporefRouter = Router();

// This function renames the "_id" attributes from the project and from their pdbInfo attribute as "identifier"
const toporefObjectCleaner = project => {
  // Add all attributes from project but the "_id"
  // Add the project "_id" in a new attribute called "identifier"
  const output = omit(project, ['_id']);
  output.identifier = project._id;

  return output;
};

(async () => {
  const client = await dbConnection; // Save the mongo database connection
  const db = client.db(process.env.DB_NAME); // Access the database
  const model = {
    // Get the desried collections from the database
    toporefs: db.collection('toporefs'),
  };

  // Root
  toporefRouter.route('/').get((_, res) => {
    // Send a response claiming the object id
    res.json({ requirement: ['ObjectID'] });
  });

  // When the request (URL) contains a project parameter
  // It is expected to be a project ID (e.g. .../projects/MCNS00001)
  toporefRouter.route('/:id').get(
    handler({
      retriever(request) {
        // Return the project which matches the request porject ID (accession)
        const query = Object.seal({ _id: request.params.id });
        return model.toporefs.findOne(query);
      },
      // If no project is found, a NOT_FOUND status is sent in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // Else, the project object is cleaned (some attributes are renamed or removed) and sent in the body
      body(response, retrieved) {
        if (retrieved) response.json(toporefObjectCleaner(retrieved));
        else response.end();
      },
    }),
  );
})();

module.exports = toporefRouter;
