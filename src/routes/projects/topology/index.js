const Router = require('express').Router;

const { ObjectId } = require('mongodb');

const omit = require('lodash').omit;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');

const topologyRouter = Router({ mergeParams: true });

// This endpoint returns some summary of data contained in the projects collection
module.exports = (_, { topologies }) => {
  // Root
  topologyRouter.route('/').get(
    handler({
      async retriever(request) {
        // Return the project which matches the request accession
        const topology = await topologies.findOne({
          project: ObjectId(request.params.project),
        });
        // If no topology was found then return here
        if (!topology) return;
        const output = omit(topology, ['_id']);
        output.identifier = topology._id;
        return output;
      },
      // If there is nothing retrieved send a INTERNAL_SERVER_ERROR status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
      },
      // If there is retrieved and the retrieved then send it
      body(response, retrieved) {
        if (retrieved) response.json(retrieved);
        else response.end();
      },
    }),
  );

  return topologyRouter;
};
