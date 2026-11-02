const { mergeArguments } = require('.');
const { BAD_REQUEST } = require('../../utils/status-codes');

// Merge the arguments of a fake request and return the resulting query, or the error if any
const merge = (query, body) => {
  const request = { query, body };
  const error = mergeArguments(request);
  return error || request.query;
};

describe('mergeArguments', () => {
  test('body arguments are merged into the query', () => {
    expect(merge({ page: '2' }, { ids: ['A0001', 'A0002'] })).toEqual({ page: '2', ids: ['A0001', 'A0002'] });
    expect(merge({ page: '2' }, {})).toEqual({ page: '2' });
  });

  test('body values are converted to their query format', () => {
    expect(merge({}, { limit: 10, raw: false, justids: true })).toEqual({ limit: '10', raw: 'false', justids: 'true' });
    expect(merge({}, { query: { organism: 'Homo sapiens' } })).toEqual({ query: '{"organism":"Homo sapiens"}' });
    expect(merge({}, { atomindices: [0, 1, 2] })).toEqual({ atomindices: ['0', '1', '2'] });
    expect(merge({}, { projection: [{ a: 1 }, { b: 1 }] })).toEqual({ projection: ['{"a":1}', '{"b":1}'] });
  });

  test('not supported body values are rejected', () => {
    for (const value of [null, [null], [[1, 2]]])
      expect(merge({}, { ids: value }).headerError).toBe(BAD_REQUEST);
  });

  test('arguments in both the query and the body must match', () => {
    expect(merge({ limit: '10' }, { limit: 10 })).toEqual({ limit: '10' });
    expect(merge({ ids: 'A0001' }, { ids: ['A0001'] })).toEqual({ ids: ['A0001'] });
    expect(merge({ ids: ['A0001', 'A0002'] }, { ids: ['A0001', 'A0002'] })).toEqual({ ids: ['A0001', 'A0002'] });
    const error = merge({ limit: '10' }, { limit: 20 });
    expect(error.headerError).toBe(BAD_REQUEST);
    expect(error.error).toMatch('"limit"');
    expect(merge({ ids: ['A0001', 'A0002'] }, { ids: ['A0002', 'A0001'] }).headerError).toBe(BAD_REQUEST);
  });
});
