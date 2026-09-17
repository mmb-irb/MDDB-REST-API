const Router = require('express').Router;
const { buildMeta, buildLinks, buildResponse, getBaseUrl, OPTIMADE_VERSION } = require('./utils');

const router = Router();

// GET /optimade/v1/info
router.get('/', (request, response) => {
  const baseUrl = getBaseUrl(request);

  const data = {
    id: '/',
    type: 'info',
    attributes: {
      api_version: OPTIMADE_VERSION,
      available_api_versions: [
        { url: `${baseUrl}/`, version: OPTIMADE_VERSION },
      ],
      formats: ['json'],
      entry_types_by_format: {
        json: ['structures', 'references', 'trajectories'],
      },
      available_endpoints: ['info', 'links', 'structures', 'references', 'trajectories'],
      is_index: false,
    },
  };

  response.json(buildResponse({
    data,
    meta: buildMeta({ query: '/info', dataReturned: 1, dataAvailable: 1, moreDataAvailable: false }),
    links: buildLinks({ baseUrl }),
  }));
});

// Property schemas for entry info endpoints — extracted from the OPTIMADE 1.2.0 spec.
// Only includes description and type metadata; sortable flag included where applicable.
const STRUCTURE_PROPERTIES = {
  id: { description: 'An entry\'s ID as defined in section Definition of Terms.', sortable: true, type: 'string' },
  type: { description: 'The name of the type of an entry.', sortable: true, type: 'string' },
  immutable_id: { description: 'The entry\'s immutable ID (e.g., an UUID).', sortable: true, type: 'string' },
  last_modified: { description: 'Date and time representing when the entry was last modified.', sortable: true, type: 'timestamp' },
  elements: { description: 'The chemical symbols of the different elements present in the structure.', sortable: true, type: 'list' },
  nelements: { description: 'Number of different elements in the structure as an integer.', sortable: true, type: 'integer' },
  elements_ratios: { description: 'Relative proportions of different elements in the structure.', sortable: false, type: 'list' },
  chemical_formula_descriptive: { description: 'The chemical formula for a structure as a string in a form chosen by the API implementation.', sortable: true, type: 'string' },
  chemical_formula_reduced: { description: 'The reduced chemical formula for a structure.', sortable: true, type: 'string' },
  chemical_formula_hill: { description: 'The chemical formula in Hill form.', sortable: true, type: 'string' },
  chemical_formula_anonymous: { description: 'The anonymous formula.', sortable: true, type: 'string' },
  dimension_types: { description: 'List of three integers describing the periodicity of the boundaries of the unit cell.', sortable: false, type: 'list' },
  nperiodic_dimensions: { description: 'An integer specifying the number of periodic dimensions.', sortable: true, type: 'integer' },
  lattice_vectors: { description: 'The three lattice vectors in Cartesian coordinates.', sortable: false, type: 'list' },
  cartesian_site_positions: { description: 'Cartesian positions of each site.', sortable: false, type: 'list' },
  nsites: { description: 'An integer specifying the length of the cartesian_site_positions property.', sortable: true, type: 'integer' },
  species: { description: 'A list describing the species of the sites of the structure.', sortable: false, type: 'list' },
  species_at_sites: { description: 'Name of the species at each site.', sortable: false, type: 'list' },
  assemblies: { description: 'A description of groups of sites that are statistically correlated.', sortable: false, type: 'list' },
  structure_features: { description: 'A list of strings that flag which special features are used by the structure.', sortable: false, type: 'list' },
  // MDDB provider-specific fields
  _mddb_name: { description: 'Name of the simulated system.', sortable: true, type: 'string' },
  _mddb_description: { description: 'Description of the simulated system.', sortable: false, type: 'string' },
  _mddb_pdb_ids: { description: 'PDB IDs associated with the structure.', sortable: false, type: 'list' },
  _mddb_collections: { description: 'Collections this project belongs to.', sortable: false, type: 'list' },
  _mddb_program: { description: 'MD simulation program used.', sortable: true, type: 'string' },
  _mddb_method: { description: 'Simulation method used.', sortable: true, type: 'string' },
  _mddb_temperature_k: { description: 'Simulation temperature in Kelvin.', sortable: true, type: 'float' },
  _mddb_force_field: { description: 'Force field used in the simulation.', sortable: true, type: 'string' },
  _mddb_ensemble: { description: 'Thermodynamic ensemble used.', sortable: true, type: 'string' },
  _mddb_simulation_length_ns: { description: 'Total simulation length in nanoseconds.', sortable: true, type: 'float' },
  _mddb_frame_count: { description: 'Number of frames in the trajectory.', sortable: true, type: 'integer' },
};

const REFERENCE_PROPERTIES = {
  id: { description: 'An entry\'s ID as defined in section Definition of Terms.', sortable: true, type: 'string' },
  type: { description: 'The name of the type of an entry.', sortable: true, type: 'string' },
  immutable_id: { description: 'The entry\'s immutable ID.', sortable: true, type: 'string' },
  last_modified: { description: 'Date and time representing when the entry was last modified.', sortable: true, type: 'timestamp' },
  authors: { description: 'List of paper authors.', sortable: false, type: 'list' },
  editors: { description: 'List of editors.', sortable: false, type: 'list' },
  doi: { description: 'The DOI of the reference.', sortable: true, type: 'string' },
  url: { description: 'The URL of the reference.', sortable: true, type: 'string' },
  title: { description: 'Title of the reference.', sortable: true, type: 'string' },
  journal: { description: 'Journal name.', sortable: true, type: 'string' },
  year: { description: 'Year of publication.', sortable: true, type: 'string' },
  bib_type: { description: 'BibTeX type of the reference.', sortable: true, type: 'string' },
  volume: { description: 'Volume number.', sortable: true, type: 'string' },
  pages: { description: 'Page numbers.', sortable: true, type: 'string' },
  number: { description: 'Issue number.', sortable: true, type: 'string' },
  // MDDB provider-specific fields
  _mddb_pdb_id: { description: 'PDB accession code.', sortable: true, type: 'string' },
  _mddb_class: { description: 'Macromolecular class of the PDB structure.', sortable: true, type: 'string' },
  _mddb_method: { description: 'Experimental method used to determine the structure.', sortable: true, type: 'string' },
  _mddb_organisms: { description: 'Organisms present in the PDB structure.', sortable: false, type: 'list' },
};

const TRAJECTORY_PROPERTIES = {
  id: { description: 'An entry\'s ID as defined in section Definition of Terms.', sortable: true, type: 'string' },
  type: { description: 'The name of the type of an entry.', sortable: true, type: 'string' },
  immutable_id: { description: 'The entry\'s immutable ID.', sortable: true, type: 'string' },
  last_modified: { description: 'Date and time representing when the entry was last modified.', sortable: true, type: 'timestamp' },
  nframes: { description: 'The number of frames stored in the trajectory.', sortable: true, type: 'integer' },
  reference_frames: { description: 'Indices of frames giving a brief overview of the trajectory.', sortable: false, type: 'list' },
  // MDDB provider-specific fields
  _mddb_id: { description: 'Accession of the MDDB structure entry this trajectory belongs to.', sortable: true, type: 'string' },
  _mddb_atom_count: { description: 'Number of atoms in the simulated system.', sortable: true, type: 'integer' },
  _mddb_name: { description: 'Name of the simulated system.', sortable: true, type: 'string' },
  _mddb_pdb_ids: { description: 'PDB IDs associated with the structure.', sortable: false, type: 'list' },
  _mddb_collections: { description: 'Collections this project belongs to.', sortable: false, type: 'list' },
  _mddb_program: { description: 'MD simulation program used.', sortable: true, type: 'string' },
  _mddb_method: { description: 'Simulation method used.', sortable: true, type: 'string' },
  _mddb_temperature_k: { description: 'Simulation temperature in Kelvin.', sortable: true, type: 'float' },
  _mddb_force_field: { description: 'Force field used in the simulation.', sortable: true, type: 'string' },
  _mddb_ensemble: { description: 'Thermodynamic ensemble used.', sortable: true, type: 'string' },
  _mddb_simulation_length_ns: { description: 'Total simulation length in nanoseconds.', sortable: true, type: 'float' },
  _mddb_md_name: { description: 'Name of this specific MD run within the project.', sortable: true, type: 'string' },
  _mddb_md_number: { description: 'Index of this MD run within the project (1-based).', sortable: true, type: 'integer' },
  _mddb_total_time_ns: { description: 'Total simulated time for this MD run in nanoseconds.', sortable: true, type: 'float' },
  _mddb_timestep_ps: { description: 'Integration timestep in picoseconds.', sortable: true, type: 'float' },
  _mddb_frame_step_ns: { description: 'Time between stored frames in nanoseconds.', sortable: true, type: 'float' },
  _mddb_water_model: { description: 'Water model used in the simulation.', sortable: true, type: 'string' },
  _mddb_box_type: { description: 'Simulation box type.', sortable: true, type: 'string' },
};

// GET /optimade/v1/info/structures
router.get('/structures', (request, response) => {
  const baseUrl = getBaseUrl(request);
  const data = {
    id: 'structures',
    type: 'info',
    formats: ['json'],
    description: 'Representing a molecular dynamics structure (system topology). Maps to an MDDB project record.',
    properties: STRUCTURE_PROPERTIES,
    output_fields_by_format: { json: Object.keys(STRUCTURE_PROPERTIES) },
  };
  response.json(buildResponse({
    data,
    meta: buildMeta({ query: '/info/structures', dataReturned: 1, dataAvailable: 1, moreDataAvailable: false }),
    links: buildLinks({ baseUrl }),
  }));
});

// GET /optimade/v1/info/references
router.get('/references', (request, response) => {
  const baseUrl = getBaseUrl(request);
  const data = {
    id: 'references',
    type: 'info',
    formats: ['json'],
    description: 'Bibliographic references. Maps to PDB crystal structure records referenced by MDDB projects.',
    properties: REFERENCE_PROPERTIES,
    output_fields_by_format: { json: Object.keys(REFERENCE_PROPERTIES) },
  };
  response.json(buildResponse({
    data,
    meta: buildMeta({ query: '/info/references', dataReturned: 1, dataAvailable: 1, moreDataAvailable: false }),
    links: buildLinks({ baseUrl }),
  }));
});

// GET /optimade/v1/info/trajectories
router.get('/trajectories', (request, response) => {
  const baseUrl = getBaseUrl(request);
  const data = {
    id: 'trajectories',
    type: 'info',
    formats: ['json'],
    description: 'MD simulation trajectories. Each entry represents one MD run within an MDDB project.',
    properties: TRAJECTORY_PROPERTIES,
    output_fields_by_format: { json: Object.keys(TRAJECTORY_PROPERTIES) },
  };
  response.json(buildResponse({
    data,
    meta: buildMeta({ query: '/info/trajectories', dataReturned: 1, dataAvailable: 1, moreDataAvailable: false }),
    links: buildLinks({ baseUrl }),
  }));
});

module.exports = router;
