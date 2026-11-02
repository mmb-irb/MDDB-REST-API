const getPagination = require('.');
const { BAD_REQUEST } = require('../status-codes');

const paginate = (query, options) => getPagination({ query }, options);

describe('getPagination', () => {
  test('uses the default page and limit', () => {
    expect(paginate({})).toEqual({ page: 1, limit: 10, skip: 0 });
    expect(paginate({}, { defaultLimit: 500, maxLimit: 1000 })).toEqual({ page: 1, limit: 500, skip: 0 });
  });

  test('parses the requested page and limit', () => {
    expect(paginate({ page: '3', limit: '20' })).toEqual({ page: 3, limit: 20, skip: 40 });
    expect(paginate({ limit: '0' })).toEqual({ page: 1, limit: 0, skip: 0 });
    expect(paginate({ limit: '100' })).toEqual({ page: 1, limit: 100, skip: 0 });
  });

  test('rejects limits greater than the maximum', () => {
    const result = paginate({ limit: '101' });
    expect(result.headerError).toBe(BAD_REQUEST);
    expect(result.error).toMatch('maximum allowed in this endpoint (100)');
    expect(paginate({ limit: '1001' }, { maxLimit: 1000 }).headerError).toBe(BAD_REQUEST);
  });

  test.each([
    [{ limit: 'abc' }],
    [{ limit: '-1' }],
    [{ limit: '1.5' }],
    [{ page: '0' }],
    [{ page: 'abc' }],
    [{ page: ['1', '2'] }],
    [{ page: '9'.repeat(20) }],
  ])('rejects wrong pagination arguments %j', query => {
    expect(paginate(query).headerError).toBe(BAD_REQUEST);
  });
});
