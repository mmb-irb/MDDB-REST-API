const parseRange = require('range-parser');

const mappingFunction = ({ start, end }) => `${start}-${end}`;

// Function which is passed to a sort() command
// Elements are sorted numerically (e.g. 1,2,11) but not in an alphabetic way (e.g. 1,11,2) by the "start" value number
const sortingFunction = (a, b) => a.start - b.start;

const getRangeForPartOrAll = (type, rangeStrings, descriptor) => {
  if (rangeStrings[type]) {
    const range = parseRange(
      descriptor.metadata[type],
      `${type}=${rangeStrings[type]}`,
      {
        combine: true,
      },
    );
    // Sort ranges numerically by the start number
    // WARNING: MUTATING!
    if (Array.isArray(range)) range.sort(sortingFunction);
    return range;
  }
  return [{ start: 0, end: descriptor.metadata[type] - 1 }];
};

const getResponseHeader = (type, range, length) =>
  `${type}=${range.map(mappingFunction).join(',')}/${length}`;

// Regexp expression used to split the range
const rangeTypeSeparator = /, *(?=[a-z])/i;

// Calculate the total output size by adding all the "end - start + 1" range values
// Warning, mutates passed array!
const addSize = array => {
  if (!Array.isArray(array)) return;
  array.size = array.reduce(
    (size, { start, end }) => size + end - start + 1,
    0,
  );
};

const handleRange = (rangeString, descriptor) => {
  const rangeStrings = (rangeString || '')
    .split(rangeTypeSeparator) // Split ranges
    .map(string => string.trim().split('=')) // Remove spaces and split by '='
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
    range.responseHeaders = [
      getResponseHeader('bytes', range, descriptor.length),
    ];
    addSize(range);
    return range;
  }
  // if none of the supported range is defined, bail
  if (!(rangeStrings.frames || rangeStrings.atoms)) return;

  // output object
  const bytes = {};
  bytes.responseHeaders = [];

  // now, try to combine ranges
  // first extract frames
  const frames = getRangeForPartOrAll('frames', rangeStrings, descriptor);
  // in case there's a problem with the range, return error code
  if (Number.isFinite(frames)) return frames;
  if (rangeString && rangeString.toLowerCase().includes('frames')) {
    bytes.responseHeaders.push(
      getResponseHeader('frames', frames, descriptor.metadata.frames),
    );
  }
  addSize(frames);
  // then, atoms
  const atoms = getRangeForPartOrAll('atoms', rangeStrings, descriptor);
  // in case there's a problem with the range, return error code
  if (Number.isFinite(atoms)) return atoms;
  if (rangeString && rangeString.toLowerCase().includes('atoms')) {
    bytes.responseHeaders.push(
      getResponseHeader('atoms', atoms, descriptor.metadata.atoms),
    );
  }
  addSize(atoms);

  const atomSize = Float32Array.BYTES_PER_ELEMENT * 3;
  const frameSize = atomSize * descriptor.metadata.atoms;

  // Here we're about to generate an array with all the combinations of frames
  // and atoms, which might be A LOT!
  // Instead, let's create an iterator
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/iterator
  bytes[Symbol.iterator] = function*() {
    let currentStartByte = null;
    let currentByte = null;
    for (const frameRange of frames) {
      for (
        let frameIndex = frameRange.start;
        frameIndex <= frameRange.end;
        frameIndex++
      ) {
        for (const atomRange of atoms) {
          const start = atomRange.start * atomSize + frameIndex * frameSize;
          if (start !== currentByte) {
            if (currentStartByte !== null) {
              yield { start: currentStartByte, end: currentByte };
            }
            currentStartByte = start;
          }
          currentByte =
            atomRange.end * atomSize + frameIndex * frameSize + atomSize - 1;
        }
      }
    }
    yield { start: currentStartByte, end: currentByte };
  };
  bytes.size = atoms.size * atomSize * frames.size;
  bytes.type = 'bytes';
  // * If we send this it might get truncated when it gets to big
  // * header size in Node HTTP Parser is limited to 80kb, see ref below
  // * https://github.com/nodejs/node/blob/cdcb1b77379f780b7b187d711c44181dbd0a6e24/deps/http_parser/http_parser.h#L63
  // bytes.responseHeaders.push(
  //   getResponseHeader('bytes', bytes, descriptor.length),
  // );
  return bytes;
};

module.exports = handleRange;
