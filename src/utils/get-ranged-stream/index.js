const PassThrough = require('stream').PassThrough;

// Load a function to check if an object is iterable
const { isIterable } = require('../auxiliar-functions');

// Found experimentally
const CHUNK_SIZE = 4194304; // bytes

// Given a list of ranges, group them in sets of a certain size (CHUNK_SIZE)
// Add also to every group the overalll start and end range values
const groupRanges = ranges => {
  const rangeGroups = [];
  let currentGroup;
  // Iterate ranges
  for (const { start, end } of ranges) {
    //console.log(`from ${start} to ${end}`);
    // If there is no current group then set it with current range parameters
    if (!currentGroup) {
      currentGroup = {
        start: start,
        end: end,
        ranges: [{ start, end }],
      };
      // If the current range is already bigger than the ckunk size set it alone
      const size = end - start;
      if (size >= CHUNK_SIZE) {
        rangeGroups.push(currentGroup);
        currentGroup = null;
      }
      continue;
    }
    // Check if this range fits in the current group
    const size = end - currentGroup.start;
    // If the current group with the current range would overcome the limit...
    // Then save the current group and create a new one for the current range
    if (size >= CHUNK_SIZE) {
      rangeGroups.push(currentGroup);
      currentGroup = {
        start: start, end: end,
        ranges: [{ start, end }],
      };
      // If the current range is already bigger than the ckunk size set it alone
      const size = end - start;
      if (size >= CHUNK_SIZE) {
        rangeGroups.push(currentGroup);
        currentGroup = null;
      }
      continue;
    }
    // If the new range fits in the current group then add it
    currentGroup.ranges.push({ start, end });
    currentGroup.end = end;
  }
  // Save last group
  if (currentGroup) rangeGroups.push(currentGroup);
  return rangeGroups;
}

// Stream only specific ranges of bytes from a file
// WARNING: Make sure ranges are ordered or this function will silently fail
const getRangedStream = (bucket, objectId, range) => {
  // If there is not range or range is not iterable then just return the whole stream
  if (!range || !isIterable(range)) return bucket.openDownloadStream(objectId);
  // If range is iterable it means we have to return only specific chunks of the input stream
  const outputStream = new PassThrough();
  // Given a list of ranges, group them in sets of a certain size
  // This allows to process several small input chunks in bigger compacted output chunks
  // This dramatically improves the efficiency when sending response chunks thorugh the internet
  const rangeGroups = groupRanges(range);
  // Note that the async function MUST be here
  // The await of the promise that the stream has been consumed is to avoid opening several download streams
  // We wait for one stream to finish before opening the next one
  (async () => {
    // Now, open a mongo download stream for each ranges group
    // Then split the data chunks according to ranges inside the group
    for await (const rangeGroup of rangeGroups) {
      // create a new stream bound to this specific range part
      const rangedStream = bucket.openDownloadStream(objectId,
        { start: rangeGroup.start, end: rangeGroup.end + 1 });
      // Set a promise to be resolved when the ranged stream data has been fully consumed
      let resolveStreamConsumed;
      const streamConsumed = new Promise(resolve => { resolveStreamConsumed = resolve });
      // The byte length of data already read
      let progress = rangeGroup.start;
      // The current range number (iteration)
      let nrange = 0;
      // transfer data from one stream to the other
      // WARNING: Since this event is async, the stream is closed as soon as this event is emitted
      rangedStream.on('data', async data => {
        // If the stream was destroyed, just bail
        if (outputStream.destroyed) return;
        // Get current data chunk limits and length
        // They are converted to absolute bytes (i.e. in reference to the whole data stream)
        const dataStart = progress;
        const dataLength = data.length;
        const dataEnd = dataStart + dataLength + 1;
        // Get the required part of the data according to ranges
        for (let r = nrange; r < rangeGroup.ranges.length; r++) {
          // Get current range limits
          // They come in absolute bytes (i.e. in reference to the whole data stream)
          const currentRange = rangeGroup.ranges[r];
          const { start: rangeStart, end: rangeEnd } = currentRange;
          // If the start range byte is beyond the data end byte then skip the whole data chunk
          if (rangeStart > dataEnd) break;
          // Get the start and end byte relative to the current data chunk (i.e. from 0 to dataLength)
          const start = Math.max(rangeStart - dataStart, 0);
          const end = Math.min(rangeEnd - dataStart, dataLength) + 1;
          // Add the current ranged data to the output data
          const shouldContinue = outputStream.write(data.slice(start, end));
          if (!shouldContinue) {
            rangedStream.pause();
            const drain = new Promise(resolve => outputStream.once('drain', resolve));
            await drain;
            rangedStream.resume();
          }
          // If the data chunk has been fully consumed then break the loop
          if (end === dataLength + 1) break;
          nrange = r + 1;
        }
        // Add byte lengths to the counter
        progress += data.length;
        // When all ranges have been filled close the read stream
        if (nrange === rangeGroup.ranges.length) {
          rangedStream.destroy();
          resolveStreamConsumed();
        }
      });
      try {
        // wait for the end of the ranged stream
        await streamConsumed;
      } catch (error) {
        outputStream.emit('error', error);
      }
    }
    // finished looping through range parts, we can end the combined stream now
    // WARNING: Do not use outputStream.emit('end') here!!
    // This could trigger the 'end' event before all data has been consumed by the next stream
    outputStream.end();
  })();
  // Return the ranged stream
  return outputStream;
};

module.exports = getRangedStream;
