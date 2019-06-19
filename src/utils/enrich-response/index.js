const enrichResponse = output => {
  output._links = output._links || {};
  return output;
};

module.exports = enrichResponse;
