// This filter return an object
// It is used for mongo DB queries, since only objects are allowed
// If the environment is tagged as "production" only "published: true" results are returned from mongo
// Otherwise, all results are returned from mongo
// It is calculated once and then widely used

// Read the property "NODE_ENV" from the global ".env" file
const env = process.env.NODE_ENV.toLowerCase();

// The object is sealed (i.e. not modificable) to prevent further bugs
const publishedFilter = Object.seal(
  env === 'production' || env === 'prod' ? { published: true } : {},
);

module.exports = publishedFilter;
