const getCustomTimeoutMiddleware = require('.');

describe('custom-timeout middleware', () => {
  describe('middleware creation', () => {
    let middleware;

    beforeEach(() => {
      middleware = getCustomTimeoutMiddleware({
        general: 1000,
        stale: 500,
        extended: 2000,
      });
    });

    it('should return a function', () => {
      expect(middleware).toBeInstanceOf(Function);
    });

    it('should call next() one', () => {
      const nextSpy = jest.fn();
      middleware({ path: '' }, { on() {} }, nextSpy);

      expect(nextSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('implementation', () => {});
});
