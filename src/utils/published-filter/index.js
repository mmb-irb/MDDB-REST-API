const process = require('process');

const env = (process.env.NODE_ENV || '').toLowerCase();

const publishedFilter = Object.seal(
  env === 'production' || env === 'prod' ? { published: true } : {},
);

module.exports = publishedFilter;
