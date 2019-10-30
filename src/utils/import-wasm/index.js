const { readFileSync } = require('fs');

const loader = require('assemblyscript/lib/loader');

const PAGE_SIZE = 0x10000; // fixed page size: 16KiB, or in hex 0x10000
const getNPages = bytes => Math.ceil(bytes / PAGE_SIZE);

const importWA = (path, memorySize = 1) => {
  let bytes = memorySize;

  const moduleContent = readFileSync(path);
  const compiled = new WebAssembly.Module(moduleContent);

  let instance;
  const memory = new WebAssembly.Memory({ initial: bytes });

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
      return bytes;
    },
    // set internal memory size in bytes and grow WebAssembly internal memory
    set(value) {
      const currentNPages = getNPages(bytes);
      bytes = value;
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
