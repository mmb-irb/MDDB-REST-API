const parseRange = require('range-parser');

const mappingFunction = ({ start, end }) => `${start}-${end}`;

const getResponseHeader = (type, range, length) =>
  `${type}=${range.map(mappingFunction).join(',')}/${length}`;

const getRangeForPartOrAll = (type, rangeStrings, descriptor) => {
  if (rangeStrings[type]) {
    return parseRange(
      descriptor.metadata[type],
      `${type}=${rangeStrings[type]}`,
      { combine: true },
    );
  }
  return [{ start: 0, end: descriptor.metadata[type] - 1 }];
};

const rangeTypeSeparator = /, *(?=[a-z])/i;

const handleRange = (rangeString, descriptor) => {
  const rangeStrings = (rangeString || '')
    .split(rangeTypeSeparator)
    .map(string => string.trim().split('='))
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
    return range;
  }
  // if none of the supported range is defined, bail
  if (!(rangeStrings.frames || rangeStrings.atoms)) return;

  // output object
  const bytes = [];
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
  // then, atoms
  const atoms = getRangeForPartOrAll('atoms', rangeStrings, descriptor);
  // in case there's a problem with the range, return error code
  if (Number.isFinite(atoms)) return atoms;
  if (rangeString && rangeString.toLowerCase().includes('atoms')) {
    bytes.responseHeaders.push(
      getResponseHeader('atoms', atoms, descriptor.metadata.atoms),
    );
  }

  const atomSize = Float32Array.BYTES_PER_ELEMENT * 3;
  const frameSize = atomSize * descriptor.metadata.atoms;
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
            bytes.push({ start: currentStartByte, end: currentByte });
          }
          currentStartByte = start;
        }
        currentByte =
          atomRange.end * atomSize + frameIndex * frameSize + atomSize - 1;
      }
    }
  }
  bytes.push({ start: currentStartByte, end: currentByte });
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
