// assume we already starting streaming from range.min to range.max
const responseWriterForRange = (range, response, preSliced = false) => {
  if (!range || !range.length || (range.length === 1 && preSliced)) {
    return buffer => response.write(buffer);
  }

  let currentIndex = preSliced ? range.min : 0;
  let currentRangeIndex = 0;
  return buffer => {
    const startIndex = currentIndex;
    const finalIndex = startIndex + buffer.length;

    while (currentRangeIndex < range.length) {
      const { start, end } = range[currentRangeIndex];
      // range is not included in current buffer
      if (finalIndex <= start) {
        // skip this buffer
        break;
      }
      let sliceStart;
      if (start < finalIndex && start >= startIndex) {
        sliceStart = start - startIndex;
      }
      let sliceEnd;
      // end of range is within this buffer
      if (end < finalIndex) {
        sliceEnd = end - startIndex + 1;
        // we can try to process next range on next loop
        currentRangeIndex++;
      }
      response.write(buffer.slice(sliceStart, sliceEnd));
      // end of range is not within this buffer (opposite to previous "if")
      if (end >= finalIndex) {
        // finish looping
        break;
      }
    }

    currentIndex = finalIndex;
  };
};

module.exports = responseWriterForRange;
