const { Transform } = require('stream');

const importWA = require('../import-wasm');

// 1 coordinate: 4 bytes in binary, 8 in plain text -> ratio 2
// also, every 10 coordinates (or 80 bytes), add a newline character -> 1 / 80
// equation:
//   text_bytes = floor(binary_bytes * 2 + binary_bytes / 80)
//   = floor(2.025 * binary_bytes)
const MULTIPLIER = x => Math.floor(2.025 * x);

// get number of new line characters that will be needed
const getNNewLines = (currentCountInLine, nValues) =>
  Math.floor((currentCountInLine - 1 + nValues) / 10);

module.exports = function() {
  // keep track of the number of coordinates processed in the line
  let countInLine = 1;
  const wasmInstance = importWA('./build/optimized.wasm');

  const transform = new Transform({
    transform(chunk, _encoding, next) {
      // number of values to be processed in this chunk
      const nValues = chunk.length / Float32Array.BYTES_PER_ELEMENT;
      // input offset and length
      const inputOffset = 0;
      const inputLength =
        nValues * Float32Array.BYTES_PER_ELEMENT - inputOffset;
      // output offset and length
      const outputOffset =
        Math.ceil(
          (inputOffset + inputLength) / Float64Array.BYTES_PER_ELEMENT,
        ) * Float64Array.BYTES_PER_ELEMENT;
      const outputLength =
        nValues * Float64Array.BYTES_PER_ELEMENT +
        getNNewLines(countInLine, nValues);

      // set the wasm internal memory to store the necessary data
      wasmInstance.memorySize = outputOffset + outputLength;

      // view on the bit of wasm memory dedicated to store the input
      const chunkInWA = new Uint8Array(
        wasmInstance.memory.buffer,
        inputOffset,
        inputLength / Uint8Array.BYTES_PER_ELEMENT,
      );
      // view on the bit of wasm memory dedicated to store the output
      const outputBuffer = Buffer.from(
        wasmInstance.memory.buffer,
        outputOffset,
        outputLength / Buffer.BYTES_PER_ELEMENT,
      );

      // copy binary (chunk) inside wasm-reserved memory (chunkInWA)
      chunk.copy(chunkInWA);
      // execute the transformation inside the wasm logic
      countInLine = wasmInstance.transform(nValues, outputOffset, countInLine);

      // push data out, and see if we can continue or not
      const canContinue = this.push(outputBuffer);
      if (canContinue) {
        next();
      } else {
        this._readableState.pipes.once('drain', next);
      }
    },
  });
  return transform;
};

module.exports.MULTIPLIER = MULTIPLIER;
