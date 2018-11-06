const paginate = require('express-paginate');
const PORT = 8000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const app = require('express')();

app.use(paginate.middleware(DEFAULT_LIMIT, MAX_LIMIT));

app.get('/', (_, res) => res.json({ 'api types': ['rest'] }));

app.use('/rest', require('../routes'));

module.exports = {
  app,
  start() {
    return app.listen(PORT, () =>
      console.log(`API running on localhost:${PORT}`),
    );
  },
};
