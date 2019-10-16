const PassThrough = require('stream').PassThrough;

const combine = async (outputStream, bucket, objectId, range) => {
  // If no range,
  const _range = range && typeof range === 'object' ? range : [{}];
  // for each of the range parts
  for (const { start, end } of _range) {
    // create a new stream bound to this specific range part
    const rangedStream = bucket.openDownloadStream(objectId);
    // ask mongo to only send necessary part
    if (Number.isFinite(start)) rangedStream.start(start);
    if (Number.isFinite(end)) rangedStream.end(end + 1);
    // size of this range
    let rangeLength =
      Number.isFinite(start) && Number.isFinite(end) && end - start + 1;
    // create a promise which will resolve when the ranged stream ends
    const streamEnd = new Promise((resolve, reject) => {
      rangedStream.once('error', reject);
      rangedStream.once('end', resolve);
    });
    // size sent
    let size = 0;
    // transfer data from once stream to the other
    rangedStream.on('data', data => {
      let _data = data;
      // if we're gonna send too much, slice to necessary size
      // that might happen because mongo usually sends a bit too much
      if (rangeLength && size + data.length > rangeLength) {
        _data = data.slice(0, rangeLength - size);
      }
      size += _data.length;

      const shouldContinue = outputStream.write(_data);

      if (!shouldContinue) {
        rangedStream.pause();
        outputStream.once('drain', rangedStream.resume.bind(rangedStream));
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
  const outputStream = new PassThrough();
  combine(outputStream, bucket, objectId, range);
  return outputStream;
};

module.exports = combineDownloadStreams;
