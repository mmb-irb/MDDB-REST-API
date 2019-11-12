// This script converts the stored file (.bin) into web friendly format (chemical/x-trj)
// This is complex since the request is quite customizable and the transform process highly optimized

const { Transform } = require('stream');
// Allows the use of non JavaScript code and faster calculation
const importWA = require('../import-wasm');

// 1 coordinate: 4 bytes in binary, 8 in plain text -> ratio 2
// also, every 10 coordinates (or 80 bytes), add a newline character -> 1 / 80
// equation:
//   text_bytes = floor(binary_bytes * 2 + binary_bytes / 80)
//   = floor(2.025 * binary_bytes)

const MULTIPLIER = x => Math.floor(2.025 * x); // Math.floor returns the smaller closest int to the input

module.exports = function() {
  // Keep track of the current chunk number
  let countInLine = 1;
  // Set an instance of non JavaScript code which is runned in a deeper (closer to the CPU) module
  // This assembly allows a faster calculation
  const wasmInstance = importWA('./build/optimized.wasm');
  // Set a transform, which is a kind of stream
  const transform = new Transform({
    transform(chunk, _encoding, next) {
      // number of values to be processed in this chunk
      const nValues = chunk.length / Float32Array.BYTES_PER_ELEMENT; // 4 bytes per element
      // input offset and length
      const inputOffset = 0; // This is always 0 at this moment
      const inputLength =
        // Nothe that nValues * Float32Array.BYTES_PER_ELEMENT equals to the chunk.length
        nValues * Float32Array.BYTES_PER_ELEMENT - inputOffset;
      // output offset and length
      const outputOffset =
        // Finds the immediately bigger than the chunk length number which is multiple of 8 (Float64Array.BYTES_PER_ELEMENT)
        Math.ceil(
          // Math.ceil returns the bigger closest int to the input
          // Note that (inputOffset + inputLength) equals to the chunk.length
          (inputOffset + inputLength) / Float64Array.BYTES_PER_ELEMENT, // 8 bytes per element
        ) * Float64Array.BYTES_PER_ELEMENT;
      const outputLength =
        nValues * Float64Array.BYTES_PER_ELEMENT + // This equals the chunk.length * 2
        // Add extra space for the line breaks
        Math.floor((countInLine - 1 + nValues) / 10); // Math.floor returns the smaller closest int to the input

      // Set the wasm internal memory to store the necessary data
      wasmInstance.memorySize = outputOffset + outputLength;

      // Standard format for the transform input
      const chunkInWA = new Uint8Array(
        wasmInstance.memory.buffer,
        inputOffset,
        inputLength / Uint8Array.BYTES_PER_ELEMENT,
      );
      // Standard format for the transform output
      const outputBuffer = Buffer.from(
        wasmInstance.memory.buffer,
        outputOffset,
        outputLength / Buffer.BYTES_PER_ELEMENT,
      );

      // Copy the current chunk inside wasm-reserved memory (chunkInWA)
      chunk.copy(chunkInWA);
      // Execute the transformation inside the wasm logic
      countInLine = wasmInstance.transform(nValues, outputOffset, countInLine);

      // Push data out, and see if we can continue or not
      const canContinue = this.push(outputBuffer);
      if (canContinue) {
        next();
      } else {
        // If not, execute the stream drain once
        this._readableState.pipes.once('drain', next);
      }
    },
  });
  return transform;
};

module.exports.MULTIPLIER = MULTIPLIER;
