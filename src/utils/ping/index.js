// Ping an URL just for them to know
// Note that we do not await the answer
// The ping is best effort: a failing link must never break the API, so failures are only logged
// Without this an unreachable link would be an unhandled rejection, which kills the process
const PING_TIMEOUT_MS = 10000;

const ping = url => {
  // Links come from project metadata, so only web links are requested
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    console.error(`Skipping ping: invalid URL ${JSON.stringify(url)}`);
    return;
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    console.error(`Skipping ping: unsupported protocol in URL ${JSON.stringify(url)}`);
    return;
  }
  fetch(parsedUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'MDposit' },
    signal: AbortSignal.timeout(PING_TIMEOUT_MS),
  })
    // The body is never read, so release the connection
    .then(response => response.body?.cancel())
    .catch(error => console.error(`Ping to ${parsedUrl.origin} failed: ${error.message}`));
};

module.exports = ping;
