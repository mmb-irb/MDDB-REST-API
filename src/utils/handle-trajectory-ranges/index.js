// Tool for combining ranges https://www.npmjs.com/package/range-parser
const parseRange = require('range-parser');

// Prepare a string to be sent back to the user through the header, just info
const getResponseHeader = (type, range, length) => {
  return `${type}=${range.map(
    ({ start, end }) => `${start}-${end}`
  ).join(',')}/${length}`;
};

// Calculate the total output size by adding all the "end - start + 1" range values
const getRangeSize = array => {
  // Return here if the argument is not an array
  if (!Array.isArray(array)) return;
  // Sum of all range lengths
  return array.reduce(
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
const handleTrajectoryRanges = (rangeInput, descriptor) => {
  const rangeStrings = (rangeInput || '')
    // Split ranges in types (e.g. frames, atoms, bytes...)
    .split(/, *(?=[a-z])/i)
    // Remove spaces and split the type name (e.g. 'frames') from the rest (e.g. '0-0,1-1...')
    .map(string => string.trim().split('='))
    // Convert the array with fromat [typename1, content1, typename2, content2] into an object
    // The object has the format {typename1: content1, typename2: content2}
    .reduce((rangeStrings, [type = '', values = '']) => {
      rangeStrings[type.trim()] = values.trim();
      return rangeStrings;
    }, {});

  // Set a function to get a type range using both its requested range and the file type maximum size
  const getTypeRange = type => {
    // Get the requested range for this type
    const requestedTypeRange = rangeStrings[type];
    // Get the size of this type according to file metadata
    const maximumTypeRange = descriptor.metadata[type]
    // If there is not range specified for this type then set a range which covers all
    if (!requestedTypeRange) return [{ start: 0, end: maximumTypeRange - 1 }];
    // parseRange is a tool which allows to combine ranges
    // Returns a negative int number to indicate an error
    const range = parseRange(maximumTypeRange, `${type}=${requestedTypeRange}`, { combine: true });
    // Sort ranges numerically by the start number
    // sort() has a direct effect on the target array even if it is not saved
    if (Array.isArray(range)) range.sort((a, b) => a.start - b.start);
    return range;
  };

  // if any range is defined as bytes, just use that
  // because it should take precedence on all the other types
  if (rangeStrings.bytes) {
    const range = parseRange(descriptor.length, `bytes=${rangeStrings.bytes}`, { combine: true });
    // Set the header
    range.responseHeaders = [  getResponseHeader('bytes', range, descriptor.length) ];
    // Calculate the size of all ranges together. The range variable is modifed.
    // DANI: No es fácil saber el número de frames/átomos que se están pidiendo en un range de bytes
    // DANI: De manera que de momento no hay soporte completo a esta funcionalidad
    // DANI: e.g. no se puede convertir a formato mdcrd (con breaklines entre frames)
    range.size = getRangeSize(range);
    return range;
  }

  // Output object returned at the end
  const range = {};
  range.responseHeaders = [];

  // if none of the supported range is defined then return a generic range for the whole trajectory data
  if (!(rangeStrings.frames || rangeStrings.atoms)) {
    range.size = descriptor.length;
    range.type = 'bytes';
    range.frameCount = descriptor.metadata.frames;
    range.atomCount = descriptor.metadata.atoms;
    return range;
  }

  // Try to combine frame ranges
  const frames = getTypeRange('frames');
  // In case there's a problem with the range, return error code from parseRange
  // -2 signals a malformed header string
  // -1 signals an unsatisfiable range
  if (Number.isFinite(frames)) return frames;
  if (rangeInput && rangeInput.toLowerCase().includes('frames')) {
    // Set the header
    range.responseHeaders.push(
      getResponseHeader('frames', frames, descriptor.metadata.frames),
    );
  }
  // Calculate the size of all ranges together. The frames variable is modified.
  frames.size = getRangeSize(frames);
  // then, atoms
  const atoms = getTypeRange('atoms');
  // In case there's a problem with the range, return error code from parseRange
  // -2 signals a malformed header string
  // -1 signals an unsatisfiable range
  if (Number.isFinite(atoms)) return atoms;
  if (rangeInput && rangeInput.toLowerCase().includes('atoms')) {
    // Set the header
    range.responseHeaders.push(
      getResponseHeader('atoms', atoms, descriptor.metadata.atoms),
    );
  }
  // Calculate the size of all ranges together. The atoms variable is modifed.
  atoms.size = getRangeSize(atoms);

  // Calculate additional sizes
  const atomSize = Float32Array.BYTES_PER_ELEMENT * 3;
  const frameSize = atomSize * descriptor.metadata.atoms;

  // Here we're about to generate an array with all the combinations of frames
  // and atoms, which might be A LOT!
  // Instead, let's create an iterator
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/iterator
  range[Symbol.iterator] = function*() {
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
  // Calculate the final size of this ranged data in bytes
  range.size = atoms.size * atomSize * frames.size;
  range.type = 'bytes';
  // Add also the atom and frame counts
  range.frameCount = frames.size;
  range.atomCount = atoms.size;
  // If we send this it might get truncated when it gets to big
  // header size in Node HTTP Parser is limited to 80kb, see ref below
  // https://github.com/nodejs/node/blob/cdcb1b77379f780b7b187d711c44181dbd0a6e24/deps/http_parser/http_parser.h#L63

  // range.responseHeaders.push(
  //   getResponseHeader('bytes', bytes, descriptor.length),
  // );
  return range;
};

module.exports = handleTrajectoryRanges;
