// This script converts the stored file (.bin) into human friendly format (.mdcrd)
// This is complex since the request is quite customizable and the transform process highly optimized
// Atom coordinates (values) are written to lines (separated by break lines) of 10 values each
// Input values are definded by 32 bits (or 4 bytes)
// Output values are difned by 64 bits (8 bytes)

const { Transform } = require('stream');
// Allows the use of non JavaScript code and faster calculation
const importWA = require('../import-wasm');

// Each atom position is defined by 3 coordinates (x,y,z)
const VALUES_PER_ATOM = 3;

// Each line contains 10 coordinates as maximum
const VALUES_PER_LINE = 10;

// Set the bytes size of a breakline: just 1
const BYTES_PER_BREAKLINE = 1;

module.exports = function(atomCount) {
  // Keep track of the last coordinated written in the current frame at each chunk
  // It is used to know when the new frame breakline is needed in the next chunk
  let countInFrame = 1;
  // Calculate the number of values (coordinates) per frame
  const nValuesPerFrame = atomCount * VALUES_PER_ATOM;
  // Keep track of the last coordinated written in the current line at each chunk
  // It is used to know when the new line breakline is needed in the next chunk
  let countInLine = 1;
  // Calculate the number of values in the last frame line
  // This is important since these values will not count to calculate the number of end of line breaklines
  const skippedValuesPerFrame = nValuesPerFrame % VALUES_PER_LINE;
  // Set an instance of non JavaScript code which is runned in a deeper (closer to the CPU) module
  // This assembly allows a faster calculation
  // The code for this functionallity is found at 'assembly/index.ts'
  // It must be previously compiled with 'sudo npm run build'
  const wasmInstance = importWA('./build/optimized.wasm');
  // Set a transform, which is a kind of stream
  const transform = new Transform({
    transform(chunk, _encoding, next) {
      // number of values to be processed in this chunk
      const nValues = chunk.length / Float32Array.BYTES_PER_ELEMENT; // 4 bytes per value
      // input offset and length
      const inputOffset = 0; // This is always 0 at this moment
      const inputLength =
        // Note that nValues * Float32Array.BYTES_PER_ELEMENT equals to the chunk.length
        nValues * Float32Array.BYTES_PER_ELEMENT - inputOffset;
      // output offset and length
      const outputOffset =
        // Finds the immediately bigger than the chunk length number which is multiple of 8 (Float64Array.BYTES_PER_ELEMENT)
        Math.ceil(
          // Note that (inputOffset + inputLength) equals to the chunk.length
          (inputOffset + inputLength) / Float64Array.BYTES_PER_ELEMENT, // 8 bytes per value
        ) * Float64Array.BYTES_PER_ELEMENT;
      // Estimate how many break lines will be in the current chunk
      // First of all estimate the end of frame breaklines
      // 'countInFrame' is taken in count, since the chunk may start in the middle of the frame
      const frameBreaklines = Math.floor(
        (countInFrame - 1 + nValues) / nValuesPerFrame,
      );
      // Estimate the last frame value to be written in the current chunk
      countInFrame = (nValues + countInFrame) % nValuesPerFrame;
      // Estimate how many values in line will be 'skipped' by the end of frame breakline
      const skippedValues = frameBreaklines * skippedValuesPerFrame;
      // Estimate the number of end of line breaklines
      // 'countInLine' is taken in count, since the chunk may start in the middle of the line
      const periodicBreaklines = Math.floor(
        (countInLine - 1 + nValues - skippedValues) / VALUES_PER_LINE,
      );
      // Add together end of frame breaklines and end of line breaklines counts
      const nBreaklines = frameBreaklines + periodicBreaklines;
      // Estimate the output bytes length
      // Add extra space for the line breaks, which weight 1 byte each
      const outputLength =
        nValues * Float64Array.BYTES_PER_ELEMENT +
        nBreaklines * BYTES_PER_BREAKLINE;

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
      // After this line the value of outputBuffer is changed
      countInLine = wasmInstance.transform(
        nValues,
        nValuesPerFrame,
        outputOffset,
      );

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

// DEPRECTAED
// 1 coordinate: 4 bytes in binary, 8 in plain text -> ratio 2
// also, every 10 coordinates (or 80 bytes), add a newline character -> 1 / 80
// equation:
//   text_bytes = floor(binary_bytes * 2 + binary_bytes / 80)
//   = floor(2.025 * binary_bytes)

// Estimate the output bytes size from the input bytes size
const CONVERTER = (inputBytes, atomCount) => {
  // Calculate the base bytes length
  // 1 coordinate: 4 bytes in binary, 8 in plain text -> ratio 2
  const textBytes = inputBytes * 2;
  // Estimate how many break lines will be in the current chunk
  // Calculate the number of values (coordinates) per frame
  const nValuesPerFrame = atomCount * VALUES_PER_ATOM;
  // Calculate the number of values in the last frame line
  // This is important since these values will not count to calculate the number of end of line breaklines
  const skippedValuesPerFrame = nValuesPerFrame % VALUES_PER_LINE;
  // Number of values to be processed in this chunk
  const nValues = inputBytes / Float32Array.BYTES_PER_ELEMENT; // 4 bytes per value
  // First of all estimate the end of frame breaklines
  // Althought there is a Math.floor, this division should always return an integer number
  const frames = Math.floor(nValues / nValuesPerFrame);
  // Estimate how many values in line will be 'skipped' by the end of frame breakline
  const skippedValues = frames * skippedValuesPerFrame;
  // Estimate the number of end of line breaklines
  const lines = Math.floor((nValues - skippedValues) / VALUES_PER_LINE);
  // Get bytes length for end of frame breaklines and end of line breaklines together
  const breaklineBytes = (frames + lines) * BYTES_PER_BREAKLINE;

  return textBytes + breaklineBytes;
};

module.exports.CONVERTER = CONVERTER;
