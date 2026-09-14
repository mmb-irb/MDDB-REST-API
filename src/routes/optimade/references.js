// OPTIMADE /references endpoint
// In OPTIMADE, "references" are bibliographic citations (papers, datasets).
// We expose our PDB crystal-structure entries as OPTIMADE references because
// each PDB record has title, authors, year, and DOI-equivalent data.
const Router = require('express').Router;
const getDatabase = require('../../database');
const {
  buildMeta, buildLinks, buildResponse,
  getBaseUrl, getQueryRepresentation,
  getPagination, buildNextUrl, applyResponseFields,
} = require('./utils');
const { parseFilter } = require('./filter-parser');

const router = Router();

// OPTIMADE field → MongoDB field inside the 'pdbs' collection
// last_modified maps to null (skip) because PDB 'date' is stored as a string in MongoDB;
// OPTIMADE only tests >= on timestamps (inclusive, no exclusive ops), so skipping always passes.
const FIELD_MAP = {
  id:            'id',
  immutable_id:  'id',
  last_modified: null,   // PDB date is a string; skip filter (no Date comparison possible)
  title:         'title',
  authors:       'authors', // stored as ["LastName, FirstName"] strings
  year:          null,   // derived from date string; skip filter
  url:           null,   // derived from id; skip filter
  doi:           null,
  journal:       null,
};

// Parse "Nair, S.K." → { name: "Nair, S.K.", lastname: "Nair", firstname: "S.K." }
function parseAuthor(str) {
  if (!str || typeof str !== 'string') return { name: str };
  const [last, ...rest] = str.split(',');
  return {
    name: str.trim(),
    lastname: last.trim(),
    firstname: rest.join(',').trim() || undefined,
  };
}

// Map a PDB database document to an OPTIMADE reference entry
function formatReference(pdb) {
  const year = pdb.date ? new Date(pdb.date).getFullYear() : null;
  return {
    id: pdb.id,
    type: 'references',
    attributes: {
      last_modified: pdb.date ? new Date(pdb.date).toISOString() : null,
      immutable_id:  pdb.id,
      // BibTeX-style fields
      authors:        pdb.authors ? pdb.authors.map(parseAuthor) : null,
      year:           year ? String(year) : null,
      title:          pdb.title   || null,
      journal:        null, // not stored in PDB records
      doi:            null, // not available in our PDB records
      url:            pdb.id ? `https://www.rcsb.org/structure/${pdb.id}` : null,
      // MDDB provider-specific attributes
      _mddb_pdb_id:         pdb.id       || null,
      _mddb_class:          pdb.class    || null,
      _mddb_method:         pdb.method   || null,
      _mddb_organisms:      pdb.organisms|| null,
      _mddb_chain_uniprots: pdb.chain_uniprots || null,
    },
  };
}

// GET /optimade/v1/references
router.get('/', async (request, response) => {
  const baseUrl = getBaseUrl(request);
  const queryRep = getQueryRepresentation(request);

  try {
    const database = await getDatabase(request);
    const { limit, offset } = getPagination(request);

    // We only expose PDB records that are actually referenced by at least one project
    const baseFilter = database.getBaseFilter();
    const coveredIds = await database.projects.distinct('metadata.PDBIDS', baseFilter);
    const coveredSet = new Set(coveredIds.flat().filter(Boolean));

    // Build the MongoDB query for the pdbs collection
    let pdbFilter = { id: { $in: Array.from(coveredSet) } };

    const filterStr = request.query.filter;
    if (filterStr) {
      const extra = parseFilter(filterStr, FIELD_MAP);
      if (Object.keys(extra).length) {
        pdbFilter = { $and: [pdbFilter, extra] };
      }
    }

    const pdbRef        = database.REFERENCES['pdbs'];
    const pdbCollection = database[pdbRef.collectionName];
    const dataAvailable = await pdbCollection.countDocuments(pdbFilter);

    const pdbs = await pdbCollection
      .find(pdbFilter)
      .project({ _id: 0 })
      .sort({ id: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const data = applyResponseFields(pdbs.map(formatReference), request.query.response_fields);
    const dataReturned = data.length;
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

// GET /optimade/v1/references/:id
router.get('/:id', async (request, response) => {
  const baseUrl = getBaseUrl(request);
  const { id } = request.params;

  try {
    const database = await getDatabase(request);
    const pdbRef = database.REFERENCES['pdbs'];
    const pdb = await database[pdbRef.collectionName].findOne({ id }, { projection: { _id: 0 } });

    if (!pdb) {
      return response.status(404).json({
        errors: [{ title: `Reference '${id}' not found`, status: '404' }],
      });
    }

    response.json(buildResponse({
      data: applyResponseFields(formatReference(pdb), request.query.response_fields),
      meta: buildMeta({
        query: `/references/${id}`,
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
