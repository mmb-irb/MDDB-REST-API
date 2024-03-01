// Translates the frames query string format into a explicit frame selection in string format
const { parseQueryRange } = require('../parse-query-range');

// Set the supported dimensions in a .bin file
const SUPPORTED_DIMENSIONS = ['x', 'y', 'z', 'w'];

// Standard HTTP response status codes
const { BAD_REQUEST } = require('../status-codes');

// Prepare a string to be sent back to the user through the header, just info
const getResponseHeader = (dimension, range, length) => {
  return `${dimension}=${range.map(
    ({ start, end }) => `${start}-${end}`
  ).join(',')}/${length}`;
};

// Given a bit, get the byte where it is found
const getBitByte = bit => Math.floor(bit / 8);

// This function searches for range parameters in the request which correspond to different dimensions of a binary file
// All ranges are combined and summarized as much as possible into a single range of bytes
// * If bytes are passed in the input then just use these bytes
// * If bytes are not passed then calculate them from the combination of ranges an atoms
// Range metadata for the response header is also returned
// Size of every dimension is also returned
const handleRanges = (request, parsedRanges, descriptor) => {
  // Get the available dimensions in the file
  const fileMetadata = descriptor.metadata;
  const dimensions = SUPPORTED_DIMENSIONS.filter(dimension => fileMetadata[dimension]);
  // If the file has not dimensions then there is nothing to do here
  if (dimensions.length === 0) return {};
  // Search for query parameters with these names in the request
  const rangeLocations = [request.body, request.query];
  // Get all requested ranges in the query
  const rangeStrings = {};
  // Search for a bytes range in the request
  for (const rangeLocation of rangeLocations) {
    const rangeString = rangeLocation.bytes;
    if (!rangeString) continue;
    rangeStrings.bytes = rangeString;
    break;
  }
  // Save the range string of each dimension
  for (const dimension of dimensions) {
    // Get the dimension name
    const dimensionName = fileMetadata[dimension].name;
    // Iterate over the different locations where a query parameter may be found
    for (const rangeLocation of rangeLocations) {
      // Try with the dimension itself
      const rangeString = rangeLocation[dimension];
      // Try with the dimension name
      const nameRangeString = rangeLocation[dimensionName];
      // If we had no result then continue
      if (!rangeString && !nameRangeString) continue;
      // If we have both results we must check they match
      if (rangeString && nameRangeString) {
        // If they match they would be redundant but correct
        // If they do not match however we must send an error since we have a conflict
        if (rangeString !== nameRangeString) return {
          headerError: BAD_REQUEST,
          error: `Two different ranges were passed for "${dimension}" and "${dimensionName}" but they are the same`
        }
      }
      // Now set any of the results as the actual value
      rangeStrings[dimension] = rangeString || nameRangeString;
      break;
    }
  }

  // If none of the supported ranges is defined then return a not iterable range
  // This will make the trajectory stream not ranged at all
  const requestedRangesCount = Object.keys(rangeStrings).length + Object.keys(parsedRanges).length;
  if (requestedRangesCount === 0) {
    const range = { byteSize: descriptor.length, responseHeaders: [] };
    // Set the whole range for every dimension
    dimensions.forEach(dimension => {
      const dimensionLength = fileMetadata[dimension].length;
      range[dimension] = [{ start: 0, end: dimensionLength - 1 }];
      range[dimension].nvalues = dimensionLength;
    });
    // Calculate the total number of values in the whole range and add it to the output object
    range.nvalues = dimensions.reduce((acc, dim) => range[dim].nvalues * acc, 1);
    // Set an additional ranger which will be useful for the parsing
    range.parseByteRanger = function* () {
      const endBit = range.nvalues * fileMetadata.bitsize;
      const bitProgress = range.nvalues * fileMetadata.bitsize - 1;
      yield { start: 0, end: getBitByte(endBit), offset: 0, progress: bitProgress };
    };
    // We return the range here and since it is not iterable there will be no ranged stream further
    return range;
  }

  // If we have a range of bytes then handle it apart
  // DANI: No se ha provado
  if (rangeStrings.bytes) {
    // Bytes range is not combinable with any other range and it must be passed alone
    if (Object.keys(rangeStrings).length !== 1) return {
      headerError: BAD_REQUEST,
      error: `Bytes range is not combinable with any other range and thus it must be passed alone`
    }
    // Parse the range string
    const range = parseQueryRange(rangeStrings.bytes, fileMetadata.bytes.length);
    if (range.error) return range;
    // Set the header
    range.responseHeaders = [  getResponseHeader('bytes', range, descriptor.length) ];
    // Calculate the bytes size
    range.byteSize = range.reduce((size, { start, end }) => size + end - start + 1, 0);
    // Tag it as a bytes request
    range.byteRequest = true;
    // We return the range here since it is already in bytes
    return range;
  }

  // Set the output object returned at the end
  const range = { responseHeaders: [] };
  // Calculate total (not ranged) size for every step in every dimension
  let lastDimensionSize = 0;
  const dimensionValueSizes = {};

  // Check if the bitsize is multiple of 8
  // If so there is no need to mess with bits so we do it all in bytes
  const handleBytes = fileMetadata.bitsize % 8 === 0;
  const elementalSize = handleBytes ? fileMetadata.bitsize / 8 : fileMetadata.bitsize;

  // Set ranges dimension by dimension
  for (const dimension of dimensions) {
    // Get the dimension name and length
    const dimensionName = fileMetadata[dimension].name;
    const dimensionLength = fileMetadata[dimension].length;
    // Get the dimension selection string (if any)
    const rangeString = rangeStrings[dimension];
    // Get the already parsed range (if any)
    const alreadyParsedRange = parsedRanges[dimension];
    // If we already have a parsed range then use it
    if (alreadyParsedRange) {
      range[dimension] = alreadyParsedRange;
    }
    // If there is a selection string then parse it
    // If there is no range then let the whole dimension intact
    else if (rangeString) {
      // Parse the range string and store it in the range object
      const parsedRange = parseQueryRange(rangeString, dimensionLength);
      if (parsedRange.error) return parsedRange;
      range[dimension] = parsedRange;
    }
    else {
      range[dimension] = [{ start: 0, end: dimensionLength - 1 }];
    }
    // Calculate the size of the ranged dimension
    range[dimension].nvalues = range[dimension].reduce((size, { start, end }) => size + end - start + 1, 0);
    // Set if the dimensions is whole or not
    range[dimension].whole = range[dimension].nvalues === dimensionLength;
    // Add range metadata to the header
    const header = getResponseHeader(dimensionName, range[dimension], dimensionLength);
    range.responseHeaders.push(header);
    // Calculate the size of this dimension
    // Size may be measured in bytes or bits depending on the file bitsize
    // If the last dimenstion size is 0 then it means this is the first dimension
    // Otherwise we must use the last dimension size to know the current dimension size
    const dimensionValueSize = lastDimensionSize === 0 ? elementalSize : lastDimensionSize;
    dimensionValueSizes[dimension] = dimensionValueSize;
    lastDimensionSize = dimensionValueSize * dimensionLength;
  }

  // Calculate the total number of values in the whole range and add it to the output object
  range.nvalues = dimensions.reduce((acc, dim) => range[dim].nvalues * acc, 1);

  // In case all ranges are whole we return the range now that it is not yet iterable
  // This will make the trajectory stream not ranged at all
  if (Object.values(range).every(r => r.whole)) return range;

  // Here we're about to generate an array with the combinations of all dimensions, which might be A LOT!
  // In order to save memory we generate them on the fly

  // Set a recursive generator
  const dimensionRangeGenerator = function* (currentDimension, containedDimensions, accumulatedOffset) {
    const currentDimensionSize = dimensionValueSizes[currentDimension];
    // If we have contained dimensions then yield the next dimension generators
    if (containedDimensions.length > 0) {
      const nextDimension = containedDimensions[0];
      const lastingDimensions = containedDimensions.slice(1);
      // Iterate over the ranged values
      for (const r of range[currentDimension]) {
        for (let v = r.start; v <= r.end; v++) {
          const nextOffset = v * currentDimensionSize;
          const gen = dimensionRangeGenerator(nextDimension, lastingDimensions, accumulatedOffset + nextOffset);
          for (const value of gen) yield value;
        }
      }
    }
    // If this is the first dimension (i.e. the last reverse dimension) then yield the actual byte ranges
    else {
      for (const r of range[currentDimension]) {
        const start = accumulatedOffset + (r.start * currentDimensionSize);
        const end = accumulatedOffset + ((r.end + 1) * currentDimensionSize) - 1;
        yield { start, end };
      }
    }
  };

  // Get the list of dimensions but excluding the first dimensions if they are whole
  // This way we do not generate a range for every 'row' in this dimension while other rows are together
  const dimensionsToIterate = [];
  for (const dimension of dimensions) {
    const isWhole = range[dimension].whole;
    if (isWhole && dimensionsToIterate.length === 0) continue;
    dimensionsToIterate.push(dimension);
  }
  // Get the iterable dimensions in reverse order and split them in the first and the rest
  const reverseDimensions = dimensionsToIterate.reverse();
  const firstDimension = reverseDimensions[0];
  const furtherDimensions = reverseDimensions.slice(1);
  // Initiate the recursive generator
  const ranger = () => dimensionRangeGenerator(firstDimension, furtherDimensions, 0);

  // Note that ranger still may be bits or bytes
  // Make the conversion to bytes in case we are handling bits
  let byteRanger;
  if (handleBytes) byteRanger = ranger;
  else {
    // We set the byte ranger for bytes to be downloaded from the database
    // Note that byte ranges may overlap so we must merge them to improve efficiency during download
    byteRanger = function* () {
      const bitRanges = ranger();
      const firstBitRange = bitRanges.next().value;
      let currentRange = { start: getBitByte(firstBitRange.start), end: getBitByte(firstBitRange.end) };
      for (const r of bitRanges) {
        const start = getBitByte(r.start);
        // It may look like the end should be ceil instead of floor
        // However we always set the last included byte, and the byte including this bit is the floor one
        const end = getBitByte(r.end);
        // If we are overlapping with the last range then we update it
        if (start === currentRange.end || start === currentRange.end + 1) {
          currentRange.end = end;
          continue;
        }
        // Otherwise, we yield the current range an set a new one
        yield currentRange;
        currentRange = { start, end };
      }
      // There will always be a last range to be sent
      yield currentRange;
    }
    // Now we set an additional ranger which will be useful for the parsing
    // Keep as many byte ranges as bit ranges and include the bit offset for each range
    // Include also the number of value per range
    range.parseByteRanger = function* () {
      const bitRanges = ranger();
      for (const r of bitRanges) {
        // Yield the current range
        yield {
          start: getBitByte(r.start),
          end: getBitByte(r.end),
          offset: r.start % 8,
          progress: r.end - r.start
        };
      }
    }
  }

  // Use ths to debug the generator
  // console.log('DEBUG');
  // const debugRanges = Array.from(byteRanger());
  // console.log(debugRanges.length);
  // console.log(debugRanges.splice(0,9));
  // console.log(debugRanges.splice(debugRanges.length - 10));
  // console.log('LIMIT: ' + descriptor.length);

  // Calculate the total range byte size by reducing all values from the byte ranger
  let byteSize = 0;
  for (const r of byteRanger()) {
    byteSize += r.end - r.start + 1;
  }
  range.byteSize = byteSize;

  // By setting the symbol iterator we dfine what is to be returned when trying to iterate over the range object
  range[Symbol.iterator] = byteRanger;
  return range;
};

module.exports = handleRanges;
