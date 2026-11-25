// Standard HTTP response status codes
const { MISDIRECTED_REQUEST } = require('../../utils/status-codes');
// Get the request host, which may be forced in the environment
const { getHost } = require('../../utils/auxiliar-functions');
const { isKnownHost } = require('../../utils/host-config');

// Refuse requests whose host has no configuration in config.yml
// The host is sent by the client, so the API behaviour (e.g. hiding unpublished projects) cannot depend on a guess
// Thus unknown hosts get an error which explains the problem instead of a default behaviour
const knownHostMiddleware = (request, response, next) => {
  const host = getHost(request);
  if (isKnownHost(host)) return next();
  response.status(MISDIRECTED_REQUEST).json(
    `The host "${host}" of this request is not configured in this API, so it cannot be served. ` +
      'If this is your host, add it to config.yml. If a proxy changes the host of the requests, ' +
      'force the configured host with HOST in the .env file',
  );
};

module.exports = { knownHostMiddleware };
