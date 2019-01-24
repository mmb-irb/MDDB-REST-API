// assume we already starting streaming at range.min
const responseWriterForRange = (range, response) => {
  // TODO: implement multiple range values
  // currentRangeIndex = 0;
  // currentFileIndex = range[currentRangeIndex].min;
  return buffer => {
    // let finalFileIndex = currentRangeIndex + buffer.length;
    // if (finalFileIndex <= range[currentRangeIndex].end) {}
    // console.log(buffer, buffer.length);
    response.write(buffer);
  };
};
