// readFileSync reads files and save the data in binary
const { readFileSync } = require('fs');

const loader = require('assemblyscript/lib/loader');

const PAGE_SIZE = 0x10000; // fixed page size: 16KiB, or in hex 0x10000
// Divides the number of bytes between the defined bytes size of a page and rounds the result
const getNPages = bytes => Math.ceil(bytes / PAGE_SIZE);

// This function builds a special assembly which is able to calculate faster
// This assembly is used to convert .bin files into .trj files when it is possible
// TRJ is not the default format (it is binary) so this is not usually run
const importWA = (path, memorySize = 1) => {
  let bytes = memorySize;
  // Read a script with non JavaScript code
  const moduleContent = readFileSync(path);
  // Compiles this non JavaScript code in a deeper (closer to the CPU) module
  const compiled = new WebAssembly.Module(moduleContent);

  let instance;
  // Creates a new memory object with an initial size of memorySize * 64 kb
  const memory = new WebAssembly.Memory({ initial: bytes });

  // Set the "env" object, which is used later to instantiate the AssemblyScript module
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

  // Instantiate the AssemblyScript module and set its memory to the previously defined memory
  instance = loader.instantiateSync(compiled, { env });
  instance.memory = memory;

  // Establish memory size getter/setter on the instance
  // get() - instance.memorySize
  // set() - instance.memorySize = value
  Object.defineProperty(instance, 'memorySize', {
    get() {
      // Returns the memory size
      return bytes;
    },
    // Sets the desired memory value and then check if more memory pages are needed
    set(value) {
      const currentNPages = getNPages(bytes);
      bytes = value;
      const wantedNPages = getNPages(value);
      const delta = wantedNPages - currentNPages;
      if (delta > 0) memory.grow(delta);
    },
  });

  return instance;
};

module.exports = importWA;
module.exports._getNPages = getNPages;
module.exports._PAGE_SIZE = PAGE_SIZE;
