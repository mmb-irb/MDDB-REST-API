const process = require('process');

const publishedFilter = Object.seal(
  process.env.NODE_ENV === 'production' ? { published: true } : {},
);

module.exports = publishedFilter;
