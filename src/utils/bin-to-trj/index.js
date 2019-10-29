const { Transform } = require('stream');

const importWA = require('../import-wasm');

// 1 coordinate: 4 bytes in binary, 8 in plain text -> ratio 2
// also, every 10 coordinates (or 80 bytes), add a newline character -> 1 / 80
// equation:
//   text_bytes = floor(binary_bytes * 2 + binary_bytes / 80)
//   = floor(2.025 * binary_bytes)
const MULTIPLIER = x => Math.floor(2.025 * x);
const getNNewLines = (currentCountInLine, nValues) =>
  Math.floor((currentCountInLine - 1 + nValues) / 10);

module.exports = function() {
  // keep track of the number of coordinates processed in the line
  let countInLine = 1;
  const wasmInstance = importWA('./build/optimized.wasm');

  const transform = new Transform({
    transform(chunk, _encoding, next) {
      // test block
      const nValues = chunk.length / Float32Array.BYTES_PER_ELEMENT;
      const inputOffset = 0;
      const inputLength =
        nValues * Float32Array.BYTES_PER_ELEMENT - inputOffset;
      const outputOffset =
        Math.ceil(
          (inputOffset + inputLength) / Float64Array.BYTES_PER_ELEMENT,
        ) * Float64Array.BYTES_PER_ELEMENT;
      // +1 for extra new line at the end
      const outputLength =
        nValues * Float64Array.BYTES_PER_ELEMENT +
        getNNewLines(countInLine, nValues);

      wasmInstance.memorySize = outputOffset + outputLength;

      const chunkInWA = new Uint8Array(
        wasmInstance.memory.buffer,
        inputOffset,
        inputLength / Uint8Array.BYTES_PER_ELEMENT,
      );
      const outputBuffer = Buffer.from(
        wasmInstance.memory.buffer,
        outputOffset,
        outputLength / Buffer.BYTES_PER_ELEMENT,
      );
      // console.time('WebAssembly');
      chunk.copy(chunkInWA);
      countInLine = wasmInstance.transform(nValues, outputOffset, countInLine);
      // console.timeEnd('WebAssembly');
      // console.log('received:\n', `'${outputBuffer.toString('ascii')}'`);
      const canContinue = this.push(outputBuffer);
      if (canContinue) {
        next();
      } else {
        this._readableState.pipes.once('drain', next);
      }
    },
  });
  // transform.setEncoding('ascii');
  return transform;
};

module.exports.MULTIPLIER = MULTIPLIER;
