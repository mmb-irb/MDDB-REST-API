const { INTERNAL_SERVER_ERROR } = require('../status-codes');
// Make sure the request has only supported arguments
const checkArguments = require('../check-arguments');

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
// Every endpoint must declare its supported arguments, so unsupported arguments are not silently ignored
// Supported arguments are null when they are not checked here:
// e.g. the request is redirected or arguments depend on the requested data, so the retriever checks them
module.exports = ({ supportedArguments, retriever, headers = defaultHeaders, body = defaultBody }) => {
  if (supportedArguments === undefined) throw new Error('Missing supported arguments in endpoint handler');
  const endpointHandler = async (request, response) => {
    try {
      // Make sure there are not unsupported arguments
      const argumentsError = supportedArguments && checkArguments(request, supportedArguments);
      // retrieve necessary data from wherever needed
      const retrieved = argumentsError || await retriever(request);
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
  // Expose the supported arguments, so they can be compared with the documentation
  endpointHandler.supportedArguments = supportedArguments;
  return endpointHandler;
};
