// This function returns an object with the mongo object id associated to the provided idOrAccession when it is valid
// When the idOrAccession is not valid for mongo it just returns the same idOrAccession
// In addition, it returns the provided filters

const { ObjectId } = require('mongodb');

// filter is expected to be publishedFilter
// idOrAccession is expected to be the project parameter from the request
const augmentFilterWithIDOrAccession = (filter, idOrAccession) => {
  // Creates an object called "output" that contains all the provided filters
  const output = { ...filter };
  // Check if the idOrAccession has a mongo db acceptable format
  if (ObjectId.isValid(idOrAccession)) {
    output._id = ObjectId(idOrAccession); // If so, the mongo object id is saved inside the output as a private attribute
  } else {
    output.accession = idOrAccession; // Else, the provided accesion itself is saved inside the output as a public attribute
  }
  return output;
};

module.exports = augmentFilterWithIDOrAccession;
