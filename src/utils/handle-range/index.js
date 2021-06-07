// Tool for combining ranges https://www.npmjs.com/package/range-parser
const parseRange = require('range-parser');

// Function which is passed to a sort() command
// Elements are sorted numerically (e.g. 1,2,11) but not in an alphabetic way (e.g. 1,11,2) by the "start" value number
const sortingFunction = (a, b) => a.start - b.start;

// Combine ranges if possible. Else, return a numeric error
const getRangeForPartOrAll = (type, rangeStrings, descriptor) => {
  if (rangeStrings[type]) {
    // parseRange is a tool which allows to combine ranges
    // Returns a negative int number to indicate an error
    const range = parseRange(
      // Maximum size of the resource
      descriptor.metadata[type],
      // Range
      `${type}=${rangeStrings[type]}`,
      // Options
      {
        // Combine ranges: yes
        combine: true,
      },
    );
    // Sort ranges numerically by the start number
    // sort() has a direct effect on the target array even if it is not saved
    if (Array.isArray(range)) range.sort(sortingFunction);
    return range;
  }
  // If the type is not found, send the maximum possible range
  return [{ start: 0, end: descriptor.metadata[type] - 1 }];
};
// Create a range string from a start and an end integer values
const mappingFunction = ({ start, end }) => `${start}-${end}`;

// Prepare a string to be sent back to the user through the header, just info
const getResponseHeader = (type, range, length) => {
  return `${type}=${range.map(mappingFunction).join(',')}/${length}`;
};

// Regexp expression used to split the range in types (e.g. frames, atoms, bytes...)
const rangeTypeSeparator = /, *(?=[a-z])/i;

// Calculate the total output size by adding all the "end - start + 1" range values
// Warning!! the input array will be modified!
const addSize = array => {
  // Return here if the argument is not an array
  if (!Array.isArray(array)) return;
  // Sum of all range lengths
  array.size = array.reduce(
    (size, { start, end }) => size + end - start + 1,
    0, // This 0 is the initial value used by the reduce (not the initial value of the array)
  );
};

// This function process different input ranges which may contain frames, atoms, or bytes
// Also combinations of frames, atoms and bytes at the same time are allowed
// Ranges are combined or summarized as much as possible
// Finally. a list with all bytes ranges is returned
// * If bytes are passed in the input then just use these bytes
// * If bytes are not passed then calculate them from the combination of ranges an atoms
// In addition, ranges metadata is sent to the header
// The desciprot contains metadata such ranges maximum size or type lengths (e.g. nº of atoms)
const handleRange = (rangeInput, descriptor) => {
  const rangeStrings = (rangeInput || '')
    // Split ranges in types (e.g. frames, atoms, bytes...)
    .split(rangeTypeSeparator)
    // Remove spaces and split the type name (e.g. 'frames') from the rest (e.g. '0-0,1-1...')
    .map(string => string.trim().split('='))
    // Convert the array with fromat [typename1, content1, typename2, content2] into an object
    // The object has the format {typename1: content1, typename2: content2}
    .reduce((rangeStrings, [type = '', values = '']) => {
      rangeStrings[type.trim()] = values.trim();
      return rangeStrings;
    }, {});

  // if any range is defined as bytes, just use that
  // because it should take precedence on all the other types
  if (rangeStrings.bytes) {
    const range = parseRange(descriptor.length, `bytes=${rangeStrings.bytes}`, {
      combine: true,
    });
    // Set the header
    range.responseHeaders = [
      getResponseHeader('bytes', range, descriptor.length),
    ];
    // Calculate the size of all ranges together. The range variable is modifed.
    addSize(range);
    return range;
  }

  // Output object returned at the end
  const bytes = {};
  bytes.responseHeaders = [];

  // if none of the supported range is defined the return a generic range for the whole trajectory data
  if (!(rangeStrings.frames || rangeStrings.atoms)) {
    const bytesLength = descriptor.length;
    bytes.size = bytesLength;
    bytes.type = 'bytes';
    return bytes;
  }

  // Try to combine frame ranges
  const frames = getRangeForPartOrAll('frames', rangeStrings, descriptor);
  // In case there's a problem with the range, return error code from parseRange
  // -2 signals a malformed header string
  // -1 signals an unsatisfiable range
  if (Number.isFinite(frames)) return frames;
  if (rangeInput && rangeInput.toLowerCase().includes('frames')) {
    // Set the header
    bytes.responseHeaders.push(
      getResponseHeader('frames', frames, descriptor.metadata.frames),
    );
  }
  // Calculate the size of all ranges together. The frames variable is modifed.
  addSize(frames);
  // then, atoms
  const atoms = getRangeForPartOrAll('atoms', rangeStrings, descriptor);
  // In case there's a problem with the range, return error code from parseRange
  // -2 signals a malformed header string
  // -1 signals an unsatisfiable range
  if (Number.isFinite(atoms)) return atoms;
  if (rangeInput && rangeInput.toLowerCase().includes('atoms')) {
    // Set the header
    bytes.responseHeaders.push(
      getResponseHeader('atoms', atoms, descriptor.metadata.atoms),
    );
  }
  // Calculate the size of all ranges together. The atoms variable is modifed.
  addSize(atoms);

  // Claculate additional sizes
  const atomSize = Float32Array.BYTES_PER_ELEMENT * 3;
  const frameSize = atomSize * descriptor.metadata.atoms;

  // Here we're about to generate an array with all the combinations of frames
  // and atoms, which might be A LOT!
  // Instead, let's create an iterator
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/iterator
  bytes[Symbol.iterator] = function*() {
    let currentStartByte = null;
    let currentEndByte = null;
    for (const frameRange of frames) {
      for (
        let frameIndex = frameRange.start;
        frameIndex <= frameRange.end;
        frameIndex++
      ) {
        for (const atomRange of atoms) {
          const start = atomRange.start * atomSize + frameIndex * frameSize;
          if (start !== currentEndByte) {
            if (currentStartByte !== null) {
              yield { start: currentStartByte, end: currentEndByte };
            }
            currentStartByte = start;
          }
          currentEndByte =
            atomRange.end * atomSize + frameIndex * frameSize + atomSize - 1;
        }
      }
    }
    yield { start: currentStartByte, end: currentEndByte };
  };
  bytes.size = atoms.size * atomSize * frames.size;
  bytes.type = 'bytes';

  // If we send this it might get truncated when it gets to big
  // header size in Node HTTP Parser is limited to 80kb, see ref below
  // https://github.com/nodejs/node/blob/cdcb1b77379f780b7b187d711c44181dbd0a6e24/deps/http_parser/http_parser.h#L63

  // bytes.responseHeaders.push(
  //   getResponseHeader('bytes', bytes, descriptor.length),
  // );
  return bytes;
};

module.exports = handleRange;
