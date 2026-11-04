// Client for one MDDB REST API: a node's own or the global one, which redirects project data to its node
const http = require('http');
const { Readable } = require('stream');

const TIMEOUT_MS = 60000;
// Tools refuse bigger results, so one call can't flood the model's context
const MAX_CHARS = 40000;

// Requests to the API this MCP runs in, through localhost
// fetch drops the Host header, which the API reads to pick the node configuration, so they go through http instead
// Redirects lead to the node that stores the project, so they are followed from its public URL
// The responses carry the public URL, which is where the links tools give point to
const createLocalFetch = ({ localUrl, publicUrl, host }) => (url, { headers, signal } = {}) =>
  new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { ...headers, host }, signal }, message => {
      const { location } = message.headers;
      if (message.statusCode >= 300 && message.statusCode < 400 && location) {
        message.resume();
        resolve(fetch(location, { headers, signal }));
        return;
      }
      const responseHeaders = Object.entries(message.headers).flatMap(([key, value]) =>
        Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]);
      const response = new Response(Readable.toWeb(message), { status: message.statusCode, headers: responseHeaders });
      Object.defineProperty(response, 'url', { value: String(url).replace(localUrl, publicUrl) });
      resolve(response);
    });
    request.on('error', reject);
  });

// fetch follows redirects, so per-project requests to the global API reach the owning node
const request = async (baseUrl, path, params, fetchApi, headers) => {
  const url = new URL(path, baseUrl.replace(/\/*$/, '/'));
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  }
  const response = await fetchApi(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const message = `HTTP ${response.status} from ${url.pathname}: ${errorMessage(await response.text())}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response;
};

// Get the JSON an API path answers
const createApi = (baseUrl, fetchApi = fetch) => async (path, params = {}) =>
  (await request(baseUrl, path, params, fetchApi)).json();

// Start a download only to read its headers: whether it works, and what and where it serves
const createProbe = (baseUrl, fetchApi = fetch) => async (path, params = {}) => {
  // Compressed responses have no length
  const response = await request(baseUrl, path, params, fetchApi, { 'accept-encoding': 'identity' });
  await response.body?.cancel();
  const length = response.headers.get('content-length');
  return {
    // The node's URL when the global API redirected there, so the link works without following redirects
    url: response.url,
    filename: response.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1],
    contentType: response.headers.get('content-type') ?? undefined,
    // Trajectories are streamed without a length
    bytes: length === null ? undefined : Number(length),
  };
};

// The API answers errors with a JSON string, a JSON object or an Express HTML page
const errorMessage = text => {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    return parsed.error ?? parsed.message ?? text;
  } catch {
    return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  }
};

module.exports = { MAX_CHARS, createLocalFetch, createApi, createProbe };
