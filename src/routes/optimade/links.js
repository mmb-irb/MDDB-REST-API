const Router = require('express').Router;
const {
  buildMeta, buildLinks, buildResponse,
  getBaseUrl, getQueryRepresentation, OPTIMADE_VERSION,
} = require('./utils');

const router = Router();

// GET /optimade/v1/links
// Returns links to known OPTIMADE implementations related to this provider.
// We list ourselves as the sole child endpoint.
router.get('/', (request, response) => {
  const baseUrl = getBaseUrl(request);

  const data = [
    {
      id: 'mddb',
      type: 'links',
      attributes: {
        name: 'MDDB OPTIMADE API',
        description: 'Molecular Dynamics DataBase at IRB Barcelona',
        base_url: baseUrl,
        homepage: 'https://mddb.irbbarcelona.org',
        link_type: 'child',
        aggregate: 'ok',
        api_version: OPTIMADE_VERSION,
        version: OPTIMADE_VERSION,
        provider: {
          name: 'MDDB',
          description: 'Molecular Dynamics DataBase',
          prefix: 'mddb',
          homepage: 'https://mddb.irbbarcelona.org',
        },
        entry_types_by_format: { json: ['structures', 'references', 'trajectories'] },
      },
    },
  ];

  const meta = buildMeta({
    query: getQueryRepresentation(request),
    dataReturned: data.length,
    dataAvailable: data.length,
    moreDataAvailable: false,
  });

  const links = buildLinks({ baseUrl });

  response.json(buildResponse({ data, meta, links }));
});

module.exports = router;
