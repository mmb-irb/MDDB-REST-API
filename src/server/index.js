const paginate = require('express-paginate');

const routes = require('../routes');

const PORT = 8000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const app = require('express')();

app.use(paginate.middleware(DEFAULT_LIMIT, MAX_LIMIT));

app.get('/', (_, res) => res.json({ 'api types': ['rest'] }));
app.get('/rest', (_, res) => res.json({ 'api versions': ['v1', 'current'] }));

app.use('/rest/v1', routes);
app.use('/rest/current', routes);

module.exports = {
  app,
  start() {
    return app.listen(PORT, () =>
      console.log(`API running on localhost:${PORT}`),
    );
  },
};
