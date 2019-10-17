module.exports = (retriever, serializer) => async (request, response) =>
  serializer(response, await retriever(request, response.locals), request);
