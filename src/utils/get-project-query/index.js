// This function returns an object with the mongo object id
// This id is associated to the provided idOrAccession when it is valid
// When the idOrAccession is not valid for mongo it just returns the same idOrAccession
// In addition, it returns the provided filters

const { ObjectId } = require('mongodb');

// Set a function to ckeck if a string is a mongo id
// WARNING: Do not use the builtin 'ObjectId.isValid'
// WARNING: It returns true with whatever string 12 characters long
const isObjectId = string => /[a-z0-9]{24}/.test(string);

// Configure which collections are returned according to the host (client) who is asking
const hostConfigs = require('../../../config.js').hosts;

// Read the property "NODE_ENV" from the global ".env" file
const env = process.env.NODE_ENV.toLowerCase();

// Set the published filter according to the enviornment (.env file)
// If the environment is tagged as "production" only published projects are returned from mongo
const publishedFilter = Object.seal(
  env === 'production' || env === 'prod' ? { published: true } : {},
);

// Set the collection filter according to the request URL
// This filter is applied over the project metadata 'collections', nothing to do with mongo collections
// Note that unknown hosts (e.g. 'localhost:8000') will get all simulations, with no filter
const getCollectionFilter = request => {
  // NEVER FORGET: For the host to be inherited (and not 'localhost') you need to configure your apache
  // Add the line 'ProxyPreserveHost On' in the API location settings
  const host = request.get('host');
  const hostConfig = hostConfigs[host];
  if (!hostConfig) return {};
  const hostCollection = hostConfig.collection;
  return Object.seal(
    hostCollection ? { 'metadata.COLLECTIONS': hostCollection } : {},
  );
};

// Join both published and collection filters in one single filter which is widely used
const getBaseFilter = request => {
  const collectionFilter = getCollectionFilter(request);
  return { ...publishedFilter, ...collectionFilter };
};

// Given the API request, set the project(s) query by the following steps:
// 1 - Set a published filter according to if it we are in a development or production environment
// 2 - Set a collection filter based on the origin of the call
// 3 - Set a project and md filter based on the id or accession in the request
const getProjectQuery = request => {
  // Add the base filter to the query
  const baseFilter = getBaseFilter(request);
  const query = { ...baseFilter };
  // Add the actual project and md filters
  const idOrAccession = request.params.project;
  // Check if the idOrAccession is an id
  if (isObjectId(idOrAccession)) query._id = ObjectId(idOrAccession);
  // otherwise we asume it is an accession
  else query.accession = idOrAccession;
  // Return the query
  return query;
};

module.exports = {
  getBaseFilter,
  getProjectQuery,
};
