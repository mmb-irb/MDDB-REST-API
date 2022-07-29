// This function returns an object with the mongo object id
// This id is associated to the provided idOrAccession when it is valid
// When the idOrAccession is not valid for mongo it just returns the same idOrAccession
// In addition, it returns the provided filters

const { ObjectId } = require('mongodb');

// Set a function to ckeck if a string is a mongo id
// WARNING: Do not use the builtin 'ObjectId.isValid'
// WARNING: It returns true with whatever string 12 characters long
const isObjectId = string => /[a-z0-9]{24}/.test(string);

// filter is expected to be the base filter
// idOrAccession is expected to be the project parameter from the request
const augmentFilterWithIDOrAccession = (filter, idOrAccession) => {
  // Creates an object called "output" that contains all the provided filters
  const output = { ...filter };
  // Check if the idOrAccession has a mongo db acceptable format
  if (isObjectId(idOrAccession)) {
    // If so, the mongo object id is saved inside the output as a private attribute
    output._id = ObjectId(idOrAccession);
  } else {
    // Else, the provided accesion itself is saved inside the output as a public attribute
    output.accession = idOrAccession;
  }
  return output;
};

module.exports = augmentFilterWithIDOrAccession;
