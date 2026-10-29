const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Standard HTTP response status codes
const { BAD_REQUEST, NOT_FOUND } = require('../../../utils/status-codes');
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

// Parse a list of indices which may come in ranged notation (e.g. 1-3,5) or as a list
// Ranged notation is parsed along with the topology, where ranges are checked against the number of atoms, residues and chains
const parseIndices = indices => {
  if (indices === undefined) return [];
  if (typeof indices === 'string') return indices;
  return indices.map(Number);
};

// This endpoint returns a project topology
// Note that topology may be requested both through GET and POST methods
// POST method was implemented to allow long atom selections
const topologyHandler = handler({
  supportedArguments: ['raw', 'dupbonds', 'include', 'exclude', 'atomindices', 'resindices', 'chaindices'],
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
    // Check if bonds are requested in both bonded atoms
    const dupbonds = request.query.dupbonds;
    const duplicatedBonds = dupbonds !== undefined && dupbonds !== 'false';
    // The user may request a selection of atom, residue and/or chain indices
    // We check both the body (in case it is a POST) and the query (in case it is a GET)
    const selection = {
      atomIndices: parseIndices(request.body.atomindices || request.query.atomindices),
      residueIndices: parseIndices(request.body.resindices || request.query.resindices),
      chainIndices: parseIndices(request.body.chaindices || request.query.chaindices),
    };
    const anySelection = Object.values(selection).some(indices => typeof indices === 'string' || indices.length > 0);
    if (anySelection && isRaw) return {
      headerError: BAD_REQUEST,
      error: 'Atom, residue and chain selections are not supported when requesting raw data.'
    }
    if (duplicatedBonds && isRaw) return {
      headerError: BAD_REQUEST,
      error: 'Duplicated bonds are not supported when requesting raw data.'
    }
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
    // If the topology is requested raw then return it as it is stored in the database
    if (isRaw) {
      const rawTopology = await database.topologies.findOne(
        { project: project.data.internalId },
        { projection: { _id: false, project: false } },
      );
      if (!rawTopology) return {
        headerError: NOT_FOUND,
        error: `Project ${project.accession} has no topology`
      };
      return rawTopology;
    }
    // Make the list of final fields to retrieve
    let requestedFields = TOPOLOGY_FIELDS;
    if (includeFields) requestedFields = includeFields;
    if (excludeFields) requestedFields = new Set( Array.from(TOPOLOGY_FIELDS).filter(
      field => !excludeFields.has(field)) );
    // Get the topology data
    const topologyData = await project.getTopologyData(requestedFields, selection, duplicatedBonds);
    // If there was any problem then stop here
    if (topologyData.error) return topologyData;
    return topologyData;
  }
});

router.route('/').get(topologyHandler);
router.route('/').post(topologyHandler);

module.exports = router;