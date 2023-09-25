const Router = require('express').Router;

// Funtion to conver string ids to mongo object ids
const { ObjectId } = require('mongodb');

// Function to remove keys from objects
const omit = require('lodash').omit;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const { getProjectQuery, getIdOrAccession, isObjectId } = require('../../../utils/get-project-query');

const topologyRouter = Router({ mergeParams: true });

// This endpoint returns some summary of data contained in the projects collection
module.exports = (_, { projects, topologies }) => {
  // Root
  topologyRouter.route('/').get(
    handler({
      async retriever(request) {
        // If the project id is a mongo id then we can directly ask for the topology
        // If the project id is an accession we must find the project first in order to know the internal mongo id
        let projectId = getIdOrAccession(request);
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
      // Handle the response header
      headers(response, retrieved) {
        // If nothing is retrieved then send a NOT_FOUND header and end the response
        if (!retrieved) return response.sendStatus(NOT_FOUND);
        // If there is any specific header error in the retrieved then send it
        if (retrieved.headerError) response.status(retrieved.headerError);
      },
      // Handle the response body
      body(response, retrieved) {
        // If nothing is retrieved then end the response
        // Note that the header 'sendStatus' function should end the response already, but just in case
        if (!retrieved) return response.end();
        // If there is any error in the body then just send the error
        if (retrieved.error) return response.json(retrieved.error);
        // Send the response
        response.json(retrieved);
      }
    }),
  );

  return topologyRouter;
};
