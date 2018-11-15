module.exports = key => (request, response, next) => {
  response.locals[key] = request.params[key];
  next();
};
