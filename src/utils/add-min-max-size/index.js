// add min, max, and size to a range

const sortingFunction = (a, b) => a.start - b.start;

const reducerFunction = (accumulator, { start, end }) =>
  accumulator + end - start + 1;

const mappingFunction = ({ start, end }) => `${start}-${end}`;

const addMinMaxSize = (range, length) => {
  // error codes
  if (Number.isFinite(range)) return range;
  // nothing
  if (!range || !range.length) return;
  // valid range, copy original
  const output = Array.from(range);
  output.type = range.type;
  // modify
  output.sort(sortingFunction);
  output.min = output[0].start;
  output.max = output[output.length - 1].end;
  output.size = output.reduce(reducerFunction, 0);
  output.responseHeader = `${output.type}=${output
    .map(mappingFunction)
    .join(',')}/${length}`;
  return output;
};

module.exports = addMinMaxSize;
