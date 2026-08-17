const createCache = require('.');

describe('createCache()', () => {
  test('returns the cached value without producing it again', async () => {
    const cache = createCache();
    const producer = jest.fn().mockResolvedValue('value');

    expect(await cache.getOrSet('key', producer)).toBe('value');
    expect(await cache.getOrSet('key', producer)).toBe('value');
    expect(producer).toHaveBeenCalledTimes(1);
  });

  test('rebuilds a cached value when it is no longer valid', async () => {
    const cache = createCache();
    const producer = jest.fn()
      .mockResolvedValueOnce({ projectsCount: 1 })
      .mockResolvedValueOnce({ projectsCount: 2 });
    const isValid = value => value.projectsCount === 2;

    expect(await cache.getOrSet('key', producer)).toEqual({ projectsCount: 1 });
    expect(await cache.getOrSet('key', producer, isValid)).toEqual({ projectsCount: 2 });
    expect(producer).toHaveBeenCalledTimes(2);
  });

  test('shares a producer that is already in flight', async () => {
    const cache = createCache();
    let resolve;
    const result = new Promise(resolved => { resolve = resolved; });
    const producer = jest.fn(() => result);

    const first = cache.getOrSet('key', producer);
    const second = cache.getOrSet('key', producer);
    resolve('value');

    expect(await Promise.all([first, second])).toEqual(['value', 'value']);
    expect(producer).toHaveBeenCalledTimes(1);
  });
});
