const Router = require('express').Router;
const getBaseHtml = require('./base-html');

const router = Router();

// Version sub-router — all actual endpoints live under /v1
const v1 = Router();
v1.use('/info',         require('./info'));
v1.use('/links',        require('./links'));
v1.use('/structures',   require('./structures'));
v1.use('/references',   require('./references'));
v1.use('/trajectories', require('./trajectories'));

// /optimade/v1/ (root of versioned API) — HTML landing page
v1.get('/', (request, response) => {
  response.type('text/html').send(getBaseHtml(request));
});

router.use('/v1', v1);

// /optimade/versions — required by OPTIMADE spec; lists supported major versions as CSV.
// Must exist at the unversioned base URL; must NOT exist under /v1/ (validator checks 404 there).
router.get('/versions', (request, response) => {
  response
    .type('text/csv')
    .set('Content-Type', 'text/csv; header=present')
    .send('version\n1\n');
});

// /optimade/ (unversioned root) — same HTML landing page
router.get('/', (request, response) => {
  response.type('text/html').send(getBaseHtml(request));
});

module.exports = router;
