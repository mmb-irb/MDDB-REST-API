// const server = require('.');

describe.skip('server', () => {
  it('should run', () => {
    let instance;

    // expect(() => (instance = server.start())).not.toThrow();

    expect(instance.stop).toBeInstanceOf(Function);

    expect(() => instance.stop()).not.toThrow();
  });
});
