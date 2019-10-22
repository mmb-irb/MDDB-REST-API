const { sleep } = require('timing-functions');

const getCustomTimeoutMiddleware = require('.');

describe('custom-timeout middleware', () => {
  let middleware;
  let response;

  beforeEach(() => {
    middleware = getCustomTimeoutMiddleware({
      general: 1000,
      stale: 500,
      extended: 2000,
    });
    response = {
      on() {},
      destroy: jest.fn(),
      write: jest.fn(),
    };
  });
  describe('middleware creation', () => {
    it('should return a function', () => {
      expect(middleware).toBeInstanceOf(Function);
    });

    it('should call next() once', () => {
      const next = jest.fn();
      middleware({ path: '' }, response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('functionality', () => {
    it('should not timeout immediately', () => {
      middleware({ path: '' }, response, () => {});
      expect(response.destroy).not.toHaveBeenCalled();
    });

    it('should not timeout quick', async () => {
      middleware({ path: '' }, response, () => {});
      await sleep(10);
      expect(response.destroy).not.toHaveBeenCalled();
    });

    it('should timeout if stale', async () => {
      middleware({ path: '' }, response, () => {});
      await sleep(600);
      expect(response.destroy).toHaveBeenCalledTimes(1);
    });

    it('should not timeout if not stale', async () => {
      middleware({ path: '' }, response, () => {});
      await sleep(250);
      response.write('something');
      await sleep(250);
      response.write('something');
      await sleep(250);
      expect(response.destroy).not.toHaveBeenCalled();
    });

    it('should timeout normally', async () => {
      middleware({ path: '' }, response, () => {});
      await sleep(450);
      response.write('something');
      await sleep(450);
      response.write('something');
      await sleep(450);
      expect(response.destroy).toHaveBeenCalledTimes(1);
    });

    it('should timeout after longer for specific path', async () => {
      middleware({ path: 'blabla/files/kdsldk.pdb' }, response, () => {});
      await sleep(450);
      response.write('something');
      await sleep(450);
      response.write('something');
      await sleep(450);
      expect(response.destroy).not.toHaveBeenCalled();
      response.write('something');
      await sleep(450);
      response.write('something');
      await sleep(450);
      expect(response.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
