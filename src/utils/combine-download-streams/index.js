const PassThrough = require('stream').PassThrough;

// Set a function to check if an object is iterable
const isIterable = obj => {
  if (!obj) return false;
  return typeof obj[Symbol.iterator] === 'function';
};

// Found experimentally
const chunkSize = 4194304;

const combine = async (outputStream, bucket, objectId, range) => {
  const rangeArray = [...range];
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
    // create a promise which will resolve when the ranged stream ends
    const streamEnd = new Promise((resolve, reject) => {
      rangedStream.once('error', reject);
      rangedStream.once('close', resolve);
      rangedStream.once('end', resolve);
    });
    // The byte length of data already read
    let progress = rangeGroup.start;
    // The current range number (iteration)
    let nrange = 0;
    // transfer data from one stream to the other
    rangedStream.on('data', data => {
      // If the stream was destroyed, just bail
      if (outputStream.destroyed) return;
      // Set the data to be written in the output stream
      let outputData = new Buffer.alloc(0);
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
        //console.log('range: ' + r + ' (' + rangeStart + ' - ' + rangeEnd + ')');
        // If the start range byte is beyond the data end byte then skip the whole data chunk
        if (rangeStart > dataEnd) break;
        // Get the start and end byte relative to the current data chunk (i.e. from 0 to dataLength)
        const start = Math.max(rangeStart - dataStart, 0);
        const end = Math.min(rangeEnd - dataStart, dataLength) + 1;
        //console.log('range MATCH: (' + start + ' - ' + end + ')');
        // Add the current ranged data to the output data
        outputData = Buffer.concat([outputData, data.slice(start, end)]);
        // If the data chunk has been fully consumed then break the loop
        if (end === dataLength + 1) break;
        nrange = r + 1;
      }
      // Write the current data output
      const shouldContinue = outputStream.write(outputData);
      //console.log('output: ' + outputData.length);
      //console.log(outputData.length + ' / ' + range.size);
      // Add byte lengths to the counter
      progress += data.length;
      // In case of overload stop the stream and wait for it to drain before resuming the load
      if (!shouldContinue) {
        rangedStream.pause();
        outputStream.once('drain', () => rangedStream.resume());
      }
      // When all ranges have been filled close the read stream
      if (nrange === rangeArray.length) {
        rangedStream.destroy();
      }
    });
    try {
      // wait for the end of the ranged stream
      await streamEnd;
    } catch (error) {
      outputStream.emit('error', error);
    }
  }
  // finished looping through range parts, we can end the combined stream now
  outputStream.emit('end');
};

const combineDownloadStreams = (bucket, objectId, range) => {
  // If range is iterable it means we have to return only specific chunks of the input stream
  if (range && isIterable(range)) {
    const outputStream = new PassThrough();
    combine(outputStream, bucket, objectId, range);
    // Return the ranged stream
    return outputStream;
  }
  // Otherwise, return a readable stream of the whole file
  return bucket.openDownloadStream(objectId);
};

module.exports = combineDownloadStreams;
