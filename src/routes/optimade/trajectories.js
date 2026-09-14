// OPTIMADE /trajectories endpoint
// Each OPTIMADE trajectory maps to one MD simulation (a project's MD entry).
// Projects with multiple MDs produce multiple trajectory entries.
//
// ID format: "{accession}.{mdNumber}" e.g. "A0001.1"
// For single-MD projects, plain "{accession}" also resolves to MD #1 at the single endpoint.
const Router = require('express').Router;
const getDatabase = require('../../database');
const {
  buildMeta, buildLinks, buildResponse,
  getBaseUrl, getQueryRepresentation,
  getPagination, buildNextUrl,
} = require('./utils');
const { parseFilter } = require('./filter-parser');
const getRangedStream = require('../../utils/get-ranged-stream');
const handleRanges = require('../../utils/handle-ranges');
const BinToJsonlinesStream = require('./bin-to-jsonlines');

const router = Router();

// Maximum trajectories per page — each entry requires a topology query
const MAX_PAGE_LIMIT = 10;

// Maximum frames per cartesian_site_positions request
const MAX_FRAMES_PER_REQUEST = 10;

// OPTIMADE field → MongoDB field path
const FIELD_MAP = {
  id:                           'accession',
  last_modified:                'updateDate',
  nframes:                      'metadata.frameCount',
  _mddb_reference_structure_id: 'accession',
  _mddb_temperature_k:          'metadata.TEMP',
  _mddb_program:                'metadata.PROGRAM',
  _mddb_method:                 'metadata.METHOD',
  _mddb_force_field:            'metadata.FF',
  _mddb_ensemble:               'metadata.ENSEMBLE',
  _mddb_name:                   'metadata.NAME',
  _mddb_collections:            'metadata.COLLECTIONS',
  _mddb_pdb_ids:                'metadata.PDBIDS',
  _mddb_simulation_length_ns:   'metadata.LENGTH',
  _mddb_atom_count:             'metadata.atomCount',
};

// Derive element/species fields from a topology document (same logic as structures endpoint)
function deriveElementFields(topology) {
  const empty = { elements: null, nelements: null, elements_ratios: null, species: null, species_at_sites: null };
  if (!topology) return empty;

  const atomElements = topology.atom_elements;
  if (!atomElements || !atomElements.length) return empty;

  const counts = {};
  for (const el of atomElements) counts[el] = (counts[el] || 0) + 1;

  const elements        = Object.keys(counts).sort();
  const nelements       = elements.length;
  const total           = atomElements.length;
  const elements_ratios = elements.map(el => counts[el] / total);
  const species         = elements.map(el => ({
    name: el, chemical_symbols: [el], concentration: [1.0], mass: null, original_name: null,
  }));

  return { elements, nelements, elements_ratios, species, species_at_sites: atomElements };
}

// Build an OPTIMADE trajectory object from a project + MD index + optional topology.
// In OPTIMADE 1.3, structure-derived properties for trajectories are per-frame lists.
// For properties constant across all frames we use compact format: a single outer element
// means "this value is the same for every frame". E.g. elements: [["C","H","O"]].
function formatTrajectory(project, mdIndex, baseUrl, topology) {
  const meta   = project.metadata || {};
  const mds    = project.mds      || [];
  const md     = mds[mdIndex]     || {};
  const mdNum  = mdIndex + 1;
  const id     = `${project.accession}.${mdNum}`;

  // Resolve new topology format (atom_species + indices → atom_elements)
  if (topology && topology.atom_species && !topology.atom_elements) {
    topology.atom_elements = topology.atom_species_indices.map(i => topology.atom_species[i][1]);
  }
  const ef = deriveElementFields(topology);

  // nsites: prefer topology atom count (authoritative) over metadata
  const atomCount = ef.species_at_sites
    ? ef.species_at_sites.length
    : (md.atoms ?? meta.atomCount ?? null);

  const entry = {
    id,
    type: 'trajectories',
    attributes: {
      last_modified:   project.updateDate ? new Date(project.updateDate).toISOString() : null,
      immutable_id:    project._id ? `${project._id.toString()}.${mdNum}` : null,
      // Standard OPTIMADE 1.3 trajectory properties
      nframes:         md.frames ?? meta.frameCount ?? null,
      reference_frames: null,
      // Structure-derived properties — constant across frames → compact list format [value]
      elements:          ef.elements        ? [ef.elements]                   : null,
      nelements:         ef.nelements != null ? [ef.nelements]                : null,
      elements_ratios:   ef.elements_ratios  ? [ef.elements_ratios]           : null,
      species:           ef.species          ? [ef.species]                   : null,
      species_at_sites:  ef.species_at_sites ? [ef.species_at_sites]          : null,
      nsites:            atomCount != null    ? [atomCount]                   : null,
      nperiodic_dimensions: [0],
      dimension_types:      [[0, 0, 0]],
      lattice_vectors:      null,
      // Coordinate data — too large to inline; available via partial_data_links
      cartesian_site_positions: null,
      // MDDB provider-specific attributes
      _mddb_reference_structure_id: project.accession,
      _mddb_atom_count:     md.atoms               ?? meta.atomCount    ?? null,
      _mddb_md_name:        md.name                || null,
      _mddb_md_number:      mdNum,
      _mddb_total_time_ns:  md.time                ?? meta.LENGTH       ?? null,
      _mddb_timestep_ps:    meta.TIMESTEP          != null ? meta.TIMESTEP : null,
      _mddb_frame_step_ns:  meta.FRAMESTEP         != null ? meta.FRAMESTEP : null,
      _mddb_temperature_k:  meta.TEMP              != null ? meta.TEMP     : null,
      _mddb_program:        meta.PROGRAM           || null,
      _mddb_method:         meta.METHOD            || null,
      _mddb_force_field:    meta.FF                || null,
      _mddb_ensemble:       meta.ENSEMBLE          || null,
      _mddb_water_model:    meta.WAT               || null,
      _mddb_box_type:       meta.BOXTYPE           || null,
      _mddb_pdb_ids:        meta.PDBIDS            || null,
      _mddb_collections:    meta.COLLECTIONS       || null,
      _mddb_name:           meta.NAME              || null,
    },
  };

  if (baseUrl) {
    entry.meta = {
      partial_data_links: {
        cartesian_site_positions: [
          { format: 'jsonlines', link: `${baseUrl}/trajectories/${id}/cartesian_site_positions` },
        ],
      },
    };
  }

  return entry;
}

// Minimal projection for list queries
const LIST_PROJECTION = {
  accession: 1, _id: 1, updateDate: 1,
  'mds.name': 1, 'mds.frames': 1, 'mds.atoms': 1, 'mds.time': 1,
  'metadata.NAME': 1, 'metadata.DESCRIPTION': 1, 'metadata.PDBIDS': 1,
  'metadata.COLLECTIONS': 1, 'metadata.PROGRAM': 1, 'metadata.METHOD': 1,
  'metadata.TEMP': 1, 'metadata.FF': 1, 'metadata.ENSEMBLE': 1,
  'metadata.LENGTH': 1, 'metadata.frameCount': 1, 'metadata.atomCount': 1,
  'metadata.TIMESTEP': 1, 'metadata.FRAMESTEP': 1,
  'metadata.WAT': 1, 'metadata.BOXTYPE': 1,
};

const TOPOLOGY_PROJECTION = { atom_elements: 1, atom_species: 1, atom_species_indices: 1, project: 1, _id: 0 };

// GET /optimade/v1/trajectories
router.get('/', async (request, response) => {
  const baseUrl  = getBaseUrl(request);
  const queryRep = getQueryRepresentation(request);

  try {
    const database = await getDatabase(request);
    const { limit: rawLimit, offset } = getPagination(request);
    const limit = Math.min(rawLimit, MAX_PAGE_LIMIT);

    const finder = database.getBaseFilter();
    const filterStr = request.query.filter;
    if (filterStr) {
      const extra = parseFilter(filterStr, FIELD_MAP);
      if (Object.keys(extra).length) {
        if (!finder.$and) finder.$and = [];
        finder.$and.push(extra);
      }
    }

    const mdCountAgg = await database.projects.aggregate([
      { $match: finder },
      { $project: { n: { $size: { $ifNull: ['$mds', []] } } } },
      { $group: { _id: null, total: { $sum: '$n' } } },
    ]).toArray();
    const dataAvailable = mdCountAgg[0]?.total ?? 0;

    const allProjects = await database.projects
      .find(finder)
      .project(LIST_PROJECTION)
      .sort({ accession: 1 })
      .toArray();

    const trajectorySlots = [];
    for (const project of allProjects) {
      const mdCount = (project.mds || []).length;
      for (let i = 0; i < mdCount; i++) trajectorySlots.push({ project, mdIndex: i });
    }

    const pageSlots = trajectorySlots.slice(offset, offset + limit);

    // Fetch topologies for the projects on this page in one query
    const pageProjectIds = [...new Set(pageSlots.map(({ project }) => project._id))];
    const topologies = await database.topologies
      .find({ project: { $in: pageProjectIds } }, { projection: TOPOLOGY_PROJECTION })
      .toArray();
    const topologyMap = {};
    for (const topo of topologies) topologyMap[topo.project.toString()] = topo;

    const data = pageSlots.map(({ project, mdIndex }) =>
      formatTrajectory(project, mdIndex, baseUrl, topologyMap[project._id.toString()]),
    );
    const dataReturned  = data.length;
    const moreDataAvailable = offset + dataReturned < dataAvailable;

    const nextUrl = moreDataAvailable
      ? buildNextUrl(request, baseUrl, offset, limit, dataAvailable)
      : null;

    response.json(buildResponse({
      data,
      meta: buildMeta({ query: queryRep, dataReturned, dataAvailable: null, moreDataAvailable }),
      links: buildLinks({ baseUrl, next: nextUrl }),
    }));
  } catch (err) {
    const status = err.status || 500;
    response.status(status).json({
      errors: [{ title: err.message || 'Internal server error', status: String(status) }],
    });
  }
});

// GET /optimade/v1/trajectories/:id/cartesian_site_positions
// Streams frame coordinates as NDJSON (one JSON array per frame: [[x,y,z],...]).
// Defaults to 1 frame. Use ?z=start-end (1-based, inclusive) to select more.
// Aliases: ?frames=start-end (z), ?y=start-end / ?atoms=start-end (atom sub-selection).
// Response includes Link: <url>; rel="next" header when more frames are available.
router.get('/:id/cartesian_site_positions', async (request, response) => {
  const rawId = request.params.id;

  try {
    const database = await getDatabase(request);

    // Reuse the project infrastructure by mapping the OPTIMADE id to request.params.project
    request.params.project = rawId;
    const project = await database.getProject();
    if (project.error) {
      return response.status(project.headerError || 404).json({
        errors: [{ title: project.error, status: String(project.headerError || 404) }],
      });
    }

    const trajectoryDescriptor = await project.getTrajectorFileDescriptor();
    if (trajectoryDescriptor.error) {
      return response.status(404).json({
        errors: [{ title: 'Trajectory file not found for this entry', status: '404' }],
      });
    }

    // Default to first frame only when no frame range is specified
    if (!request.query.z && !request.query.frames) request.query.z = '1-1';

    const range = handleRanges(request, {}, trajectoryDescriptor);
    if (range.error) {
      return response.status(400).json({
        errors: [{ title: range.error, status: '400' }],
      });
    }

    const nFrames = range.z.nvalues;
    if (nFrames > MAX_FRAMES_PER_REQUEST) {
      return response.status(400).json({
        errors: [{
          title: `Requested ${nFrames} frames but max is ${MAX_FRAMES_PER_REQUEST}. Use ?z=start-end to select a range.`,
          status: '400',
        }],
      });
    }

    // Add Link: next header when more frames follow
    const totalFrames   = trajectoryDescriptor.metadata.z.length;
    const lastFrameIdx  = range.z[range.z.length - 1].end; // 0-based
    if (lastFrameIdx + 1 < totalFrames) {
      const nextStart = lastFrameIdx + 2;
      const nextEnd   = Math.min(lastFrameIdx + 1 + nFrames, totalFrames);
      const nextUrl   = new URL(request.originalUrl, `${request.protocol}://${request.get('host')}`);
      nextUrl.searchParams.set('z', `${nextStart}-${nextEnd}`);
      response.set('Link', `<${nextUrl.toString()}>; rel="next"`);
    }

    const atomCount     = range.y.nvalues;
    const rangedStream  = getRangedStream(database.bucket, trajectoryDescriptor._id, range);
    const jsonlinesStream = new BinToJsonlinesStream(atomCount);

    response.set('Content-Type', 'application/x-ndjson');
    rangedStream.pipe(jsonlinesStream).pipe(response);
    request.on('close', () => rangedStream.destroy());
  } catch (err) {
    const status = err.status || 500;
    response.status(status).json({
      errors: [{ title: err.message || 'Internal server error', status: String(status) }],
    });
  }
});

// GET /optimade/v1/trajectories/:id
// :id format: "A0001.1" (accession.mdNumber) or bare "A0001" (resolves to MD #1)
router.get('/:id', async (request, response) => {
  const baseUrl   = getBaseUrl(request);
  const rawId     = request.params.id;
  const parts     = rawId.split('.');
  const accession = parts[0];
  const mdNumber  = parts.length > 1 ? parseInt(parts[1], 10) : 1;

  if (isNaN(mdNumber) || mdNumber < 1) {
    return response.status(400).json({
      errors: [{ title: `Invalid trajectory id '${rawId}': md number must be a positive integer`, status: '400' }],
    });
  }

  try {
    const database = await getDatabase(request);
    const finder   = { ...database.getBaseFilter(), accession };

    const project = await database.projects.findOne(finder, { projection: LIST_PROJECTION });
    if (!project) {
      return response.status(404).json({
        errors: [{ title: `Trajectory '${rawId}' not found`, status: '404' }],
      });
    }

    const mdIndex = mdNumber - 1;
    if (!project.mds || mdIndex >= project.mds.length) {
      return response.status(404).json({
        errors: [{
          title: `MD number ${mdNumber} does not exist for project '${accession}'. ` +
                 `Valid range: 1–${(project.mds || []).length}`,
          status: '404',
        }],
      });
    }

    const topology = await database.topologies.findOne(
      { project: project._id },
      { projection: TOPOLOGY_PROJECTION },
    );

    response.json(buildResponse({
      data: formatTrajectory(project, mdIndex, baseUrl, topology),
      meta: buildMeta({ query: `/trajectories/${rawId}`, dataReturned: 1, dataAvailable: 1, moreDataAvailable: false }),
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
