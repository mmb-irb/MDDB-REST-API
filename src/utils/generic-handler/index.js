const { INTERNAL_SERVER_ERROR } = require('../status-codes');

// Set a default headers behaviour used in most endpoints
const defaultHeaders = (response, retrieved) => {
  // There should always be a retrieved object
  if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
  // If there is any specific header error in the retrieved then send it
  // Note that we do not end the response here since the body may contain useful error logs
  if (retrieved.headerError) response.status(retrieved.headerError);
}

// Set a default body behaviour used in most endpoints
const defaultBody = (response, retrieved) => {
  // If nothing is retrieved then end the response
  // Note that the header 'sendStatus' function should end the response already, but just in case
  if (!retrieved) return response.end();
  // If there is any error in the body then just send the error
  if (retrieved.error) return response.json(retrieved.error);
  // Send the response
  response.json(retrieved);
}

// This is a standard formatter used in every endpoint
module.exports = ({ retriever, headers = defaultHeaders, body = defaultBody }) => async (
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
