const PassThrough = require('stream').PassThrough;

const combine = async (outputStream, bucket, objectId, range) => {
  // If no range,
  const _range = range && typeof range === 'object' ? range : [{}];
  // for each of the range parts
  for (const { min, max } of _range) {
    // create a new stream bound to this specific range part
    const rangedStream = bucket.openDownloadStream(objectId);
    if (min) rangedStream.start(min);
    if (max) rangedStream.end(max + 1);
    // create a promise which will resolve when the ranged stream ends
    const streamEnd = new Promise((resolve, reject) => {
      rangedStream.once('error', reject);
      rangedStream.once('end', resolve);
    });
    // transfer data from once stream to the other
    rangedStream.on('data', outputStream.write.bind(outputStream));
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
  const outputStream = new PassThrough();
  combine(outputStream, bucket, objectId, range);
  return outputStream;
};

module.exports = combineDownloadStreams;
