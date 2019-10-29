const { readFileSync } = require('fs');

const loader = require('assemblyscript/lib/loader');

const PAGE_SIZE = 0x10000; // fixed page size: 16KiB, or in hex 0x10000
// the following function calculates how many pages are needed for a given
// amount of bytes
const getNPages = bytes => ((bytes + 0xffff) & ~0xffff) >>> 16;

const importWA = (path, memorySize = 1) => {
  let _m = { bytes: memorySize };

  const moduleContent = readFileSync(path);
  const compiled = new WebAssembly.Module(moduleContent);

  let instance;
  const memory = new WebAssembly.Memory({ initial: _m.bytes });

  const env = {
    abort(msg, file, line, column) {
      console.error(instance.__getString(msg));
      console.error(
        `abort called at ${instance.__getString(file)}: ${line}:${column}`,
      );
    },
    trace(msg, ...args) {
      console.log(instance.__getString(msg), ...args);
    },
    memory,
  };

  instance = loader.instantiateSync(compiled, { env });
  instance.memory = memory;

  // define getter/setter on the instance
  // That way, we just ask for an amount of bytes, then it automatically adjusts
  // the page count if needed
  Object.defineProperty(instance, 'memorySize', {
    get() {
      return _m.bytes;
    },
    // set internal memory size in bytes and grow WebAssembly internal memory
    set(value) {
      const currentNPages = getNPages(_m.bytes);
      _m.bytes = value;
      const wantedNPages = getNPages(value);
      const delta = Math.abs(wantedNPages - currentNPages);
      if (delta) memory.grow(delta);
    },
  });

  return instance;
};

module.exports = importWA;
module.exports._getNPages = getNPages;
module.exports._PAGE_SIZE = PAGE_SIZE;
