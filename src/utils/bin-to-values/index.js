// This script converts the stored file (.bin) into human friendly format (.mdcrd)
// This is complex since the request is quite customizable and the transform process highly optimized
// Atom coordinates (values) are written to lines (separated by break lines) of 10 values each
// Input values are definded by 32 bits (or 4 bytes)
// Output values are difned by 64 bits (8 bytes)

const { Transform } = require('stream');

// Allows the use of non JavaScript code and faster calculation
const importWA = require('../import-wasm');

// Set the number of bits in a byte
const BITS_PER_BYTE = 8;

// Output bytes per element (1 byte)
// DANI: Esto está hardcodeado hasta que decida una forma de pasarle el output type/bitsize
const OUTPUT_BYTES_PER_ELEMENT = Uint8Array.BYTES_PER_ELEMENT;

module.exports = (descriptor, range) => {
  // Set an instance of non JavaScript code which is runned in a deeper (closer to the CPU) module
  // This assembly allows a faster calculation
  // The code for this functionallity is found at 'assembly/binary_parser.ts'
  // It must be previously compiled with 'sudo npm run build'
  const wasmInstance = importWA('./build/binary_parser.wasm');
  // Set an additional memory space for wasm internal management
  // WARNING: This space is essential
  // If this space is not provided and the input buffer is long enought then strange things happen
  // When a variable is stored in the wasm process it tries to be written to memory but it does not
  // As a result output logs are never written and when trying to read them them they are indeed not strings
  const wasmMemoryInternalSize = importWA._PAGE_SIZE; // 64 Kb
  // Set range of bytes to be parsed including bit offsets and number of values
  // Note that this is a generator
  const parseRanges = range.parseByteRanger();
  // Set a variable to sotre the current range
  let currentRange = parseRanges.next().value;
  // Save last range end as well
  let lastEnd;
  // Set a transform, which is a kind of stream
  const transform = new Transform({
    transform(chunk, _encoding, next) {
      // First we must calculate the number of possible values in this chunk to allocate the necessary chunk
      const chunkByteSize = chunk.length;
      const chunkBitSize = chunkByteSize * BITS_PER_BYTE;
      // Set the number of bits per value
      const valuesBitSize = descriptor.metadata.bitsize;
      // Set the WASM memory
      // WASM memory is a huge binary buffer where both this process and the WASM instance have access
      // This is how they share data beyond function arguments
      // Estimate the required memory size for the parsing process: the sum of both input and output weight
      // There is no need to be sharp here, we may take more memory than we need
      // At this point we still do not know the output size but we can calculate the maximum possible required memory
      const maximumPossibleOutputValues = chunkBitSize / valuesBitSize;
      const maximumPossibleOutputSize = maximumPossibleOutputValues * OUTPUT_BYTES_PER_ELEMENT;
      const maximumPossibleTotalSize = wasmMemoryInternalSize + chunkByteSize + maximumPossibleOutputSize;
      wasmInstance.memorySize = maximumPossibleTotalSize;
      // Get the WASM memory
      const wasmMemory = wasmInstance.memory.buffer;
      // Now we must set which range of bytes in this memory are for the input and which are for the output
      // We set the first bytes for the input and we allocate as much space as the data chunk takes
      const wasmMemoryInputOffset = wasmMemoryInternalSize;
      const wasmMemoryInputLength = chunkByteSize;
      // Thus output bytes are the ones after the input bytes
      // Note that we do not define the output length at this moment
      // We do not know how many value we will parse yet
      const wasmMemoryOutputOffset = wasmMemoryInputOffset + wasmMemoryInputLength;
      // Write the chunk data into the WASM input memory
      // Note that this does not depend on bitsize in any way
      const chunkInWA = new Uint8Array(wasmMemory, wasmMemoryInputOffset, wasmMemoryInputLength);
      chunk.copy(chunkInWA);
      // Set the current chunk byte to be processed
      let currentInputByte = wasmMemoryInputOffset;
      // Set the byte we must start writting the output
      let currentOutputByte = wasmMemoryOutputOffset;
      // Set the limit byte to be read
      const lastInputByte = wasmMemoryInputOffset + chunkByteSize;
      // Process ranges until we consume the whole chunk
      while (currentInputByte < lastInputByte) {
        // Set the expected number of values in the current range
        const nextValues = (currentRange.progress + 1) / valuesBitSize;
        // Calculate the number of bytes we progress as we consume them
        // Take it as byte size - 1. A byte progress of 0 means we are still consuming 1 byte (or part of it)
        const byteProgress = currentRange.end - currentRange.start;
        // Execute the transformation inside the wasm logic
        // After this line the value of outputBuffer is changed
        // Note that this process is full sync
        // Here r.progress is the bit progress
        wasmInstance.transform(currentInputByte, currentInputByte + byteProgress, currentRange.offset,
          currentRange.offset + currentRange.progress, valuesBitSize, currentOutputByte);
        // Add the progress to the byte count
        currentInputByte += byteProgress;
        currentOutputByte += nextValues * OUTPUT_BYTES_PER_ELEMENT;
        // Update the last end
        lastEnd = currentRange.end;
        // Get the next range
        currentRange = parseRanges.next().value;
        // In case the current range does not start at the last range end we must skip to the next byte
        if (!currentRange || currentRange.start !== lastEnd) currentInputByte += 1;
      }
      // Note that a byte range may contain multiple bit ranges
      // However a bit range will never be splitted along multiple byte ranges (data chunks)
      // For this reason there is no need to check if last bytes from each chunk belong to the next range

      // Set a memory buffer for the WASM to write its output
      const wasmMemoryOutputLength = currentOutputByte - wasmMemoryOutputOffset;
      const outputBuffer = Buffer.from(wasmMemory, wasmMemoryOutputOffset, wasmMemoryOutputLength);

      // Make a copy of the offset buffer since it may change its content even after is has been pushed
      // WARNING: Skipping this part may result in duplicated chunks for big data downloads
      const safeOutputBuffer = Buffer.alloc(outputBuffer.length);
      outputBuffer.copy(safeOutputBuffer);

      // Send processed data as we call the next data chunk
      // DANI: No estoy seguro de que esto sea a prueba de back pressure
      next(null, safeOutputBuffer);
    },
  });

  return transform;
};