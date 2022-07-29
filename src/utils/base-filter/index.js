// Configure which collections are returned according to the host (client) who is asking
const hostConfig = require('../../../config.js').hosts;

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

// Filter also the results according to the request url
// Some URLs come from clients which expect only specific projects to be returned
// This filter is applied over the metadata 'collections', nothing to do with mongo collections
// Note that unknown hosts (e.g. 'localhost:8000') will get all simulations, with no filter
const getCollectionFilter = request => {
  const host = request.get('host');
  const hostCollection = hostConfig[host].collection;
  return Object.seal(
    hostCollection ? { 'metadata.COLLECTIONS': hostCollection } : {},
  );
};

// Join both published and collection filters in one single filter
const getBaseFilter = request => {
  const collectionFilter = getCollectionFilter(request);
  return { ...publishedFilter, ...collectionFilter };
};

module.exports = getBaseFilter;
