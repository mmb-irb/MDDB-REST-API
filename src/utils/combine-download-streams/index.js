const PassThrough = require('stream').PassThrough;

const combine = async (outputStream, bucket, objectId, range) => {
  const rangeArray = [...range];
  // create a new stream bound to this specific range part
  const rangedStream = bucket.openDownloadStream(objectId);
  // create a promise which will resolve when the ranged stream ends
  const streamEnd = new Promise((resolve, reject) => {
    rangedStream.once('error', reject);
    rangedStream.once('close', resolve);
    rangedStream.once('end', resolve);
  });
  // The byte length of data already read
  let progress = 0;
  // The current range number (iteration)
  let nrange = 0;
  // transfer data from one stream to the other
  rangedStream.on('data', data => {
    // If the stream was destroied, just bail
    if (outputStream.destroyed) return;
    // Set the data to be written in the output stream
    let outputData = new Buffer.alloc(0);
    // Get the required part of the data according to ranges
    for (let r = nrange; r < rangeArray.length; r++) {
      // Get current range limits
      // They come in absolute bytes (i.e. in reference to the whole data stream)
      const currentRange = rangeArray[r];
      const { start: rangeStart, end: rangeEnd } = currentRange;
      // Get current data chunk limits and length
      // They are converted to absolute bytes (i.e. in reference to the whole data stream)
      const dataStart = progress;
      const dataLength = data.length;
      const dataEnd = dataStart + dataLength + 1;
      // If the start range byte is beyond the data end byte then skip the whole data chunk
      if (rangeStart > dataEnd) break;
      // Get the start and end byte relative to the current data chunk (i.e. from 0 to dataLength)
      const start = Math.max(rangeStart - dataStart, 0);
      const end = Math.min(rangeEnd - dataStart, dataLength) + 1;
      // Add the current ranged data to the output data
      outputData = Buffer.concat([outputData, data.slice(start, end)]);
      // If the data chunk has been fully consumed then break the loop
      if (end === dataLength) break;
      nrange = r + 1;
    }
    // Write the current data output
    const shouldContinue = outputStream.write(outputData);
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
  // finished looping through range parts, we can end the combined stream now
  outputStream.emit('end');
};

const combineDownloadStreams = (bucket, objectId, range) => {
  // When asking for the whole file
  if (!(range && typeof range === 'object')) {
    // Return a readable stream of the whole file
    return bucket.openDownloadStream(objectId);
  }
  // Else, asking for parts of the file
  // Create a fake stream into which we'll push just the requested parts
  const outputStream = new PassThrough();
  combine(outputStream, bucket, objectId, range);
  // Return the created stream
  return outputStream;
};

module.exports = combineDownloadStreams;
