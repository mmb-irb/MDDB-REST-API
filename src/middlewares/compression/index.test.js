const http = require('http');
const express = require('express');

// Newer mime-db versions (1.54+) flag application/octet-stream as compressible
// Behave like the most permissive one so the test does not depend on the installed mime-db
jest.mock('compressible', () => () => true);

const { compressionMiddleware } = require('.');

// Serve a body of the given content type through the compression middleware
// Then request it accepting brotli and gzip, as browsers do, and return the response headers
const getHeaders = contentType => new Promise((resolve, reject) => {
  const app = express();
  app.use(compressionMiddleware());
  app.get('/', (_, response) => {
    const body = Buffer.alloc(100000, 'a');
    response.set('content-type', contentType);
    response.set('content-length', body.length);
    response.end(body);
  });
  const server = app.listen(0, () => {
    const options = { port: server.address().port, headers: { 'accept-encoding': 'gzip, deflate, br' } };
    http.get(options, response => {
      response.resume();
      response.on('end', () => server.close(() => resolve(response.headers)));
    }).on('error', reject);
  });
});

describe('compression middleware', () => {
  it.each(['application/json; charset=utf-8', 'chemical/x-pdb', 'chemical/x-mmcif'])('compresses %s', async contentType => {
    const headers = await getHeaders(contentType);
    expect(headers['content-encoding']).toBe('br');
  });

  // Binary coordinates do not compress, and the client needs the content length to show the download progress
  it.each(['application/octet-stream', 'text/mdcrd'])('does not compress %s and keeps its length', async contentType => {
    const headers = await getHeaders(contentType);
    expect(headers['content-encoding']).toBeUndefined();
    expect(headers['content-length']).toBe('100000');
  });
});
