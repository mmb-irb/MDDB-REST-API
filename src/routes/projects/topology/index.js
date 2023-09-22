const Router = require('express').Router;

// Funtion to conver string ids to mongo object ids
const { ObjectId } = require('mongodb');
// Set a function to ckeck if a string is a mongo id
// WARNING: Do not use the builtin 'ObjectId.isValid'
// WARNING: It returns true with whatever string 12 characters long
const isObjectId = string => /[a-z0-9]{24}/.test(string);

// Function to remove keys from objects
const omit = require('lodash').omit;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const { getProjectQuery } = require('../../../utils/get-project-query');

const topologyRouter = Router({ mergeParams: true });

// This endpoint returns some summary of data contained in the projects collection
module.exports = (_, { projects, topologies }) => {
  // Root
  topologyRouter.route('/').get(
    handler({
      async retriever(request) {
        // If the project id is a mongo id then we can directly ask for the topology
        // If the project id is an accession we must find the project first in order to know the internal mongo id
        let projectId = request.params.project;
        if (!isObjectId(projectId)) {
          // Find the project which matches the request accession
          const projectDoc = await projects.findOne(
            getProjectQuery(request),
            // And get the "_id" attribute
            { projection: { _id: true } },
          );
          // If there is no project we return here
          if (!projectDoc) return;
          projectId = projectDoc._id;
        }
        // Return the project which matches the request accession
        const topology = await topologies.findOne(
          { project: ObjectId(projectId) },
          { projection: { _id: false, project: false } },
        );
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
