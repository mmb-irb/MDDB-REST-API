const Router = require('express').Router;
const getDatabase = require('../../database');
const {
  buildMeta, buildLinks, buildResponse,
  getBaseUrl, getQueryRepresentation,
  getPagination, buildNextUrl, applyResponseFields,
} = require('./utils');
const { parseFilter } = require('./filter-parser');

// Derive OPTIMADE element fields from a topology document's atom_elements array.
// Returns null for all fields if topology is not available.
function deriveElementFields(topology) {
  if (!topology) return { elements: null, nelements: null, elements_ratios: null, species: null, species_at_sites: null };

  const atomElements = topology.atom_elements;
  if (!atomElements || !atomElements.length) {
    return { elements: null, nelements: null, elements_ratios: null, species: null, species_at_sites: null };
  }

  // Count occurrences of each element
  const counts = {};
  for (const el of atomElements) {
    counts[el] = (counts[el] || 0) + 1;
  }

  const elements        = Object.keys(counts).sort();
  const nelements       = elements.length;
  const total           = atomElements.length;
  const elements_ratios = elements.map(el => counts[el] / total);

  // OPTIMADE species: one entry per unique element symbol
  const species = elements.map(el => ({
    name:             el,
    chemical_symbols: [el],
    concentration:    [1.0],
    mass:             null,
    original_name:    null,
  }));

  return { elements, nelements, elements_ratios, species, species_at_sites: atomElements };
}

const router = Router();

// OPTIMADE field name → MongoDB field path (or constant descriptor)
// null = skip filter (legacy virtual)
// { constant: v } = always evaluates to v; filter comparison is done statically
const FIELD_MAP = {
  id:                        'accession',
  last_modified:             'updateDate',
  immutable_id:              '_id',
  nsites:                    'metadata.atomCount',
  nperiodic_dimensions:      { constant: 0 }, // always 0 for MD systems
  structure_features:        { constant: [] }, // always empty for MD systems
  // MDDB provider-specific fields
  _mddb_name:                'metadata.NAME',
  _mddb_description:         'metadata.DESCRIPTION',
  _mddb_collections:         'metadata.COLLECTIONS',
  _mddb_pdb_ids:             'metadata.PDBIDS',
  _mddb_program:             'metadata.PROGRAM',
  _mddb_method:              'metadata.METHOD',
  _mddb_temperature_k:       'metadata.TEMP',
  _mddb_force_field:         'metadata.FF',
  _mddb_ensemble:            'metadata.ENSEMBLE',
  _mddb_simulation_length_ns:'metadata.LENGTH',
  _mddb_frame_count:         'metadata.frameCount',
};

// Map a raw MongoDB project document into an OPTIMADE structure object
function formatStructure(project) {
  const meta = project.metadata || {};
  return {
    id: project.accession,
    type: 'structures',
    attributes: {
      // Standard OPTIMADE fields
      last_modified:                 project.updateDate ? new Date(project.updateDate).toISOString() : null,
      immutable_id:                  project._id ? project._id.toString() : null,
      // Element-related fields — null because we don't store element information
      // in a form directly accessible without loading topology files.
      // Per OPTIMADE spec, setting elements=null implies nelements, elements_ratios,
      // and chemical_formula_* must also be null.
      elements:                      null,
      nelements:                     null,
      elements_ratios:               null,
      chemical_formula_descriptive:  null,
      chemical_formula_reduced:      null,
      chemical_formula_hill:         null,
      chemical_formula_anonymous:    null,
      // Periodicity: MD simulations of bio-molecules are non-periodic systems
      dimension_types:               [0, 0, 0],
      nperiodic_dimensions:          0,
      lattice_vectors:               null,
      // Atomic positions require reading trajectory files; not available here
      cartesian_site_positions:      null,
      nsites:                        meta.atomCount || null,
      species_at_sites:              null,
      species:                       null,
      assemblies:                    null,
      structure_features:            [],
      // MDDB provider-specific attributes
      _mddb_name:                    meta.NAME                 || null,
      _mddb_description:             meta.DESCRIPTION          || null,
      _mddb_pdb_ids:                 meta.PDBIDS               || null,
      _mddb_collections:             meta.COLLECTIONS          || null,
      _mddb_program:                 meta.PROGRAM              || null,
      _mddb_method:                  meta.METHOD               || null,
      _mddb_temperature_k:           meta.TEMP                 != null ? meta.TEMP  : null,
      _mddb_force_field:             meta.FF                   || null,
      _mddb_ensemble:                meta.ENSEMBLE             || null,
      _mddb_authors:                 meta.AUTHORS              || null,
      _mddb_license:                 meta.LICENSE              || null,
      _mddb_license_url:             meta.LINKCENSE            || null,
      _mddb_citation:                meta.CITATION             || null,
      _mddb_simulation_length_ns:    meta.LENGTH               != null ? meta.LENGTH : null,
      _mddb_frame_count:             meta.frameCount           || null,
      _mddb_md_program_version:      meta.VERSION              || null,
      _mddb_water_model:             meta.WAT                  || null,
      _mddb_box_type:                meta.BOXTYPE              || null,
    },
  };
}

// GET /optimade/v1/structures
router.get('/', async (request, response) => {
  const baseUrl = getBaseUrl(request);
  const queryRep = getQueryRepresentation(request);

  try {
    const database = await getDatabase(request);
    const { limit, offset } = getPagination(request);

    // Build the base MongoDB filter (respects published/collection/production scoping)
    const finder = database.getBaseFilter();

    // Apply OPTIMADE filter if provided
    const filterStr = request.query.filter;
    const warnings = [];
    if (filterStr) {
      const filterQuery = parseFilter(filterStr, FIELD_MAP);
      // Merge the parsed filter into our existing finder
      if (Object.keys(filterQuery).length) {
        if (!finder.$and) finder.$and = [];
        finder.$and.push(filterQuery);
      }
    }

    const dataAvailable = await database.projects.countDocuments(finder);

    const projects = await database.projects
      .find(finder)
      .project({
        accession: 1, _id: 1, updateDate: 1,
        'metadata.NAME': 1, 'metadata.DESCRIPTION': 1, 'metadata.PDBIDS': 1,
        'metadata.COLLECTIONS': 1, 'metadata.PROGRAM': 1, 'metadata.METHOD': 1,
        'metadata.TEMP': 1, 'metadata.FF': 1, 'metadata.ENSEMBLE': 1,
        'metadata.AUTHORS': 1, 'metadata.LICENSE': 1, 'metadata.LINKCENSE': 1,
        'metadata.CITATION': 1, 'metadata.LENGTH': 1, 'metadata.frameCount': 1,
        'metadata.atomCount': 1, 'metadata.VERSION': 1, 'metadata.WAT': 1,
        'metadata.BOXTYPE': 1,
      })
      .sort({ accession: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const data = applyResponseFields(projects.map(formatStructure), request.query.response_fields);
    const dataReturned = data.length;
    const moreDataAvailable = offset + dataReturned < dataAvailable;

    const nextUrl = moreDataAvailable
      ? buildNextUrl(request, baseUrl, offset, limit, dataAvailable)
      : null;

    response.json(buildResponse({
      data,
      meta: buildMeta({ query: queryRep, dataReturned, dataAvailable: null, moreDataAvailable, warnings }),
      links: buildLinks({ baseUrl, next: nextUrl }),
    }));
  } catch (err) {
    const status = err.status || 500;
    response.status(status).json({
      errors: [{ title: err.message || 'Internal server error', status: String(status) }],
    });
  }
});

// GET /optimade/v1/structures/:id
// Enriched with topology data (elements, species, species_at_sites) when available.
router.get('/:id', async (request, response) => {
  const baseUrl = getBaseUrl(request);
  const { id } = request.params;

  try {
    const database = await getDatabase(request);
    const finder = { ...database.getBaseFilter(), accession: id };

    const project = await database.projects.findOne(finder, {
      projection: {
        accession: 1, _id: 1, updateDate: 1,
        'metadata.NAME': 1, 'metadata.DESCRIPTION': 1, 'metadata.PDBIDS': 1,
        'metadata.COLLECTIONS': 1, 'metadata.PROGRAM': 1, 'metadata.METHOD': 1,
        'metadata.TEMP': 1, 'metadata.FF': 1, 'metadata.ENSEMBLE': 1,
        'metadata.AUTHORS': 1, 'metadata.LICENSE': 1, 'metadata.LINKCENSE': 1,
        'metadata.CITATION': 1, 'metadata.LENGTH': 1, 'metadata.frameCount': 1,
        'metadata.atomCount': 1, 'metadata.VERSION': 1, 'metadata.WAT': 1,
        'metadata.BOXTYPE': 1,
      },
    });

    if (!project) {
      return response.status(404).json({
        errors: [{ title: `Structure '${id}' not found`, status: '404' }],
      });
    }

    // Fetch topology to populate element-level OPTIMADE fields
    const topology = await database.topologies.findOne(
      { project: project._id },
      { projection: { atom_elements: 1, atom_species: 1, atom_species_indices: 1, _id: 0 } },
    );

    // Handle new topology format (atom_species + atom_species_indices → atom_elements)
    if (topology && topology.atom_species && !topology.atom_elements) {
      topology.atom_elements = topology.atom_species_indices.map(i => topology.atom_species[i][1]);
    }

    const elementFields = deriveElementFields(topology);
    let data = formatStructure(project);

    // Override the null element fields with real data from topology
    Object.assign(data.attributes, elementFields);
    data = applyResponseFields(data, request.query.response_fields);

    // Also populate chemical_formula_descriptive from element counts (Hill order: C first, H second, rest alphabetically)
    if (elementFields.elements) {
      const counts = {};
      for (const el of elementFields.species_at_sites) counts[el] = (counts[el] || 0) + 1;
      const hillOrder = [
        ...['C', 'H'].filter(e => counts[e]),
        ...elementFields.elements.filter(e => e !== 'C' && e !== 'H'),
      ];
      data.attributes.chemical_formula_descriptive = hillOrder.map(el => `${el}${counts[el] > 1 ? counts[el] : ''}`).join('');
      // Reduced formula: divide by GCD
      const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
      const countVals = hillOrder.map(el => counts[el]);
      const g = countVals.reduce(gcd);
      data.attributes.chemical_formula_reduced = hillOrder.map(el => `${el}${counts[el] / g > 1 ? counts[el] / g : ''}`).join('');
      // Anonymous formula: sort by descending count, replace elements with letters A, B, C...
      const sorted = [...hillOrder].sort((a, b) => counts[b] - counts[a]);
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      data.attributes.chemical_formula_anonymous = sorted.map((el, i) => `${letters[i]}${counts[el] / g > 1 ? counts[el] / g : ''}`).join('');
    }

    response.json(buildResponse({
      data,
      meta: buildMeta({
        query: `/structures/${id}`,
        dataReturned: 1,
        dataAvailable: 1,
        moreDataAvailable: false,
      }),
      links: buildLinks({ baseUrl }),
    }));
  } catch (err) {
    const status = err.status || 500;
    response.status(status).json({
      errors: [{ title: err.message || 'Internal server error', status: String(status) }],
    });
  }
});

module.exports = router;
