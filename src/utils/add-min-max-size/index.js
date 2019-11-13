// Set min, max, and size of the total range

// Function which is passed to a sort() command
// Elements are sorted numerically (e.g. 1,2,11) but not in an alphabetic way (e.g. 1,11,2) by the "start" value number
const sortingFunction = (a, b) => a.start - b.start;

// reduce() execute a function(a,b) "stacking" over all the array values
// (i.e. f(f(f(f(a,b),c),d), etc) )
// This function is used in a reduce() to stack the (end - start + 1) value of each element in range
const reducerFunction = (accumulator, { start, end }) =>
  accumulator + end - start + 1;

const addMinMaxSize = range => {
  // If range is already finite then return it here
  if (Number.isFinite(range)) return range;
  // If there is no range or it has no length then return here
  if (!range || !range.length) return;
  // Otherwise, the range is valid. Copy the original
  const output = Array.from(range);
  output.type = range.type;
  output.responseHeaders = range.responseHeaders;
  // Sort ranges numerically by the start number
  output.sort(sortingFunction);
  output.min = output[0].start; // Set the minimum
  output.max = output[output.length - 1].end; // Set the maximum
  // Calculate the total output size by adding all the "end - start + 1" range values
  output.size = output.reduce(reducerFunction, 0); // 0 refers to the initial value
  return output;
};

module.exports = addMinMaxSize;
