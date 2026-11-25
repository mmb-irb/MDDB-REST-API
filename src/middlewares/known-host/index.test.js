jest.mock('../../utils/host-config', () => ({ isKnownHost: host => host === 'known.example.org' }));
const { knownHostMiddleware } = require('.');
const { MISDIRECTED_REQUEST } = require('../../utils/status-codes');

const run = host => {
  const result = { next: false };
  const response = { status: code => { result.status = code; return response; }, json: body => { result.body = body; } };
  knownHostMiddleware({ get: () => host }, response, () => { result.next = true; });
  return result;
};

describe('knownHostMiddleware', () => {
  test('configured hosts go on', () => {
    expect(run('known.example.org')).toEqual({ next: true });
  });

  test('not configured hosts get an error telling the host', () => {
    const { next, status, body } = run('evil.example.org');
    expect(next).toBe(false);
    expect(status).toBe(MISDIRECTED_REQUEST);
    expect(body).toContain('"evil.example.org"');
  });
});
