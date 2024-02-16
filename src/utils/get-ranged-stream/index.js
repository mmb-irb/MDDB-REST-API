const PassThrough = require('stream').PassThrough;

// Set a function to check if an object is iterable
const isIterable = obj => {
  if (!obj) return false;
  return typeof obj[Symbol.iterator] === 'function';
};

// Found experimentally
const chunkSize = 4194304;

// Stream only specific ranges of bytes from a file
const getRangedStream = (bucket, objectId, range) => {
  // If there is not range or range is not iterable then just return the whole stream
  if (!range || !isIterable(range)) return bucket.openDownloadStream(objectId);
  // If range is iterable it means we have to return only specific chunks of the input stream
  const outputStream = new PassThrough();
  // Group ranges which may fit in one single chunk according to chunkSize
  const rangeGroups = [];
  let currentGroup;
  for (const { start, end } of range) {
    // If there is no current group then set it with current range parameters
    if (!currentGroup) {
      currentGroup = {
        start: start,
        end: end,
        ranges: [{ start, end }],
      };
      // If the current range is already bigger than the ckunk size set it alone
      const size = end - start;
      if (size >= chunkSize) {
        rangeGroups.push(currentGroup);
        currentGroup = null;
      }
      continue;
    }
    // In case there is an existing current group, check if this range fits on it
    const size = end - currentGroup.start;
    // If the current group with the current range would overcome the limit...
    // Then save the current group and create a new one for the current range
    if (size >= chunkSize) {
      rangeGroups.push(currentGroup);
      currentGroup = {
        start: start,
        end: end,
        ranges: [{ start, end }],
      };
      // If the current range is already bigger than the ckunk size set it alone
      const size = end - start;
      if (size >= chunkSize) {
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

  // Now, open a mongo download stream for each ranges group
  // Then split the data chunks according to ranges inside the group
  for (const rangeGroup of rangeGroups) {
    // create a new stream bound to this specific range part
    const rangedStream = bucket.openDownloadStream(objectId);
    rangedStream.start(rangeGroup.start);
    rangedStream.end(rangeGroup.end + 1);
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
      //console.log('data: (' + dataStart + ' - ' + dataEnd + ')');
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
    (async () => {
      try {
        // wait for the end of the ranged stream
        await streamConsumed;
      } catch (error) {
        outputStream.emit('error', error);
      }
      // finished looping through range parts, we can end the combined stream now
      // WARNING: Do not use outputStream.emit('end') here!!
      // This could trigger the 'end' event before all data has been consumed by the next stream
      outputStream.end();
    })();
  }
  // Return the ranged stream
  return outputStream;
};

module.exports = getRangedStream;
