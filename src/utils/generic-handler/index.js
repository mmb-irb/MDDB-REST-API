const { INTERNAL_SERVER_ERROR } = require('../status-codes');

module.exports = ({ retriever, headers, body }) => async (
  request,
  response,
) => {
  try {
    // retrieve necessary data from wherever needed
    const retrieved = await retriever(request);
    // write and send headers
    await headers(response, retrieved);
    // if we have a HEAD request, stop here
    if (request.method === 'HEAD') {
      // close connection
      response.end();
      if (retrieved.stream) retrieved.stream.destroy();
      return;
    }
    // send headers;
    // serialize and send the body
    await body(response, retrieved, request);
  } catch (error) {
    console.error(error);
    // send error message to client and close
    response.sendStatus(error.errorCode || INTERNAL_SERVER_ERROR);
  }
};
