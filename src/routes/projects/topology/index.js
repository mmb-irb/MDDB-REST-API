const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Standard HTTP response status codes
const { BAD_REQUEST } = require('../../../utils/status-codes');
// Get the database handler
const getDatabase = require('../../../database');

const router = Router({ mergeParams: true });

// List the expected topology fields
const TOPOLOGY_FIELDS = new Set([
  'atom_names',
  'atom_elements',
  'atom_charges',
  'atom_residue_indices',
  'atom_bonds',
  'residue_names',
  'residue_numbers',
  'residue_icodes',
  'residue_chain_indices',
  'chain_names',
  'references',
  'reference_types',
  'residue_reference_indices',
  'residue_reference_numbers',
  'selections',
  'version',
]);

// This endpoint returns a project topology
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Check if the raw flag has been passed
      const raw = request.query.raw;
      const isRaw = raw !== undefined && raw !== 'false';
      // Handle requested fields
      // Note that include and exclyde fields may be one (string) or many (array)
      let includeFields = request.query.include;
      if (typeof includeFields === 'string') includeFields = new Set([includeFields]);
      if (typeof includeFields === 'object') includeFields = new Set(includeFields);
      let excludeFields = request.query.exclude;
      if (typeof excludeFields === 'string') excludeFields = new Set([excludeFields]);
      if (typeof excludeFields === 'object') excludeFields = new Set(excludeFields);
      // Make sure arguments are coherent
      if (includeFields && excludeFields) return {
        headerError: BAD_REQUEST,
        error: 'Include and exclude arguments are not compatible. Please chose one of them.'
      }
      if ((includeFields || excludeFields) && isRaw) return {
        headerError: BAD_REQUEST,
        error: 'Include and exclude arguments are not supported when requesting raw data.'
      }
      // Make sure requested field names exist and, if not, explain the possibilities
      let wrongFields = new Set();
      if (includeFields) wrongFields = new Set( Array.from(includeFields).filter(
        field => !TOPOLOGY_FIELDS.has(field)) );
      if (excludeFields) wrongFields = new Set( Array.from(excludeFields).filter(
        field => !TOPOLOGY_FIELDS.has(field)) );
      if (wrongFields.size > 0) return {
        headerError: BAD_REQUEST,
        error: `The following topology field(s) do not exist: ${Array.from(wrongFields).join(', ')}.` +
          ` Please select any number of available fields: ${Array.from(TOPOLOGY_FIELDS).join(', ')}`
      }
      // Make the list of final fields to retrieve
      let requestedFields = TOPOLOGY_FIELDS;
      if (includeFields) requestedFields = includeFields;
      if (excludeFields) requestedFields = new Set( Array.from(TOPOLOGY_FIELDS).filter(
        field => !excludeFields.has(field)) );
      // Get the topology data
      const topologyData = await project.getTopologyData(requestedFields, isRaw);
      // If there was any problem then stop here
      if (topologyData.error) return topologyData;
      return topologyData;
    }
  }),
);

module.exports = router;