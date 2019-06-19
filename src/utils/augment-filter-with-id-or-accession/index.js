const { ObjectId } = require('mongodb');

const augmentFilterWithIDOrAccession = (filter, idOrAccession) => {
  const output = { ...filter };
  if (ObjectId.isValid(idOrAccession)) {
    output._id = ObjectId(idOrAccession);
  } else {
    output.accession = idOrAccession;
  }
  return output;
};

module.exports = augmentFilterWithIDOrAccession;
