/**
 * Timeout middleware:
 * implements 3 types of timeouts:
 * general timeout: any request taking more than that time will be stopped
 * extended timeout: extend timeout for /files/ paths
 * stale timeout: if no data is transfered during that time, timeout
 */

const getCustomTimeout = ({ general, stale, extended }) => (
  request,
  response,
  next,
) => {
  const handler = () => response.destroy();

  // set the different timeouts
  const mainTimeout = setTimeout(
    handler,
    request.path.toLowerCase().includes('/files/') ? extended : general,
  );
  let staleTimeout = setTimeout(handler, stale);

  // when the response is closed in any way (error, disconnect, complete, ...)
  response.on('close', () => {
    // cancel all the current timeouts
    clearTimeout(mainTimeout);
    clearTimeout(staleTimeout);
  });

  // intercept response.write()
  const write = response.write;
  response.write = (...args) => {
    // data is flowing, reset staleTimeout
    clearTimeout(staleTimeout);
    setTimeout(handler, stale);
    write.apply(response, args);
  };

  next();
};

module.exports = getCustomTimeout;
