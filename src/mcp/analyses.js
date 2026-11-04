const { MAX_CHARS } = require('./api');

// Lists up to this length are returned whole, longer ones are summarized
const SHORT_LENGTH = 20;
// Items shown from a long list of texts or objects
const HEAD_LENGTH = 5;
const MAX_KEYS = 50;
const MAX_STRING = 200;

const round = value => Number.isInteger(value) ? value : Number(value.toPrecision(6));
const roundAll = values => values.map(value => typeof value === 'number' ? round(value) : value);

// null stands for a missing value in numeric lists (e.g. NaN in the workflow)
const isNumbers = list => list.every(item => typeof item === 'number' || item === null);
const isBooleans = list => list.every(item => typeof item === 'boolean');
const isMatrix = (list, isRow) => list.length > 0 && list.every(row => Array.isArray(row) && isRow(row));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const stats = list => {
  const numbers = list.filter(item => typeof item === 'number');
  const nulls = list.length - numbers.length || undefined;
  if (numbers.length === 0) return { length: list.length, nulls };
  let argmin = 0, argmax = 0;
  numbers.forEach((value, index) => {
    if (value < numbers[argmin]) argmin = index;
    if (value > numbers[argmax]) argmax = index;
  });
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const std = Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length);
  // Indices into the original list, nulls included
  const indices = list.flatMap((item, index) => typeof item === 'number' ? [index] : []);
  const [first, last] = roundAll([list[0], list.at(-1)]);
  return {
    length: list.length, nulls, min: round(numbers[argmin]), max: round(numbers[argmax]), mean: round(mean),
    std: round(std), argmin: indices[argmin], argmax: indices[argmax], first, last,
  };
};

const matrixStats = rows => {
  const { length, nulls, argmin, argmax, first, last, ...rest } = stats(rows.flat());
  const columns = Math.max(...rows.map(row => row.length));
  // Flat indices become [row, column] when every row has the same length
  const cell = index => index === undefined || rows.some(row => row.length !== columns)
    ? undefined : [Math.floor(index / columns), index % columns];
  return { shape: [rows.length, columns], nulls, ...rest, argmin: cell(argmin), argmax: cell(argmax) };
};

const countTrue = list => list.filter(item => item === true).length;

// The whole value, with every long list replaced by a summary of it
const summarize = value => {
  if (typeof value === 'number') return round(value);
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  if (Array.isArray(value)) {
    const isLong = value.length > SHORT_LENGTH;
    if (isNumbers(value)) return isLong ? stats(value) : roundAll(value);
    if (isBooleans(value)) return isLong ? { length: value.length, true: countTrue(value) } : value;
    if (isLong && isMatrix(value, isNumbers)) return matrixStats(value);
    if (isLong && isMatrix(value, isBooleans)) return { shape: [value.length, value[0].length], true: countTrue(value.flat()) };
    return isLong ? { length: value.length, head: value.slice(0, HEAD_LENGTH).map(summarize) } : value.map(summarize);
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    const shown = entries.slice(0, MAX_KEYS).map(([key, item]) => [key, summarize(item)]);
    if (entries.length > MAX_KEYS) shown.push(['…', `${entries.length - MAX_KEYS} more keys`]);
    return Object.fromEntries(shown);
  }
  return value;
};

const getAt = (data, path) => path.split('.').reduce((value, key, depth, keys) => {
  if (value === null || typeof value !== 'object' || !(key in value)) {
    const parent = keys.slice(0, depth).join('.') || 'the analysis';
    const available = value !== null && typeof value === 'object'
      ? Array.isArray(value) ? `indices 0-${value.length - 1}` : Object.keys(value).slice(0, MAX_KEYS).join(', ')
      : 'none, it is not a list or object';
    throw new Error(`No "${key}" in ${parent}. Available: ${available}`);
  }
  return value[key];
}, data);

// Every stride-th value, so at most maxPoints of them
const downsample = (list, stride) => list.filter((_, index) => index % stride === 0);

// One part of the analysis: series and matrices downsampled, other lists item by item
const selectPart = (data, path, range, maxPoints) => {
  const value = getAt(data, path);
  if (!Array.isArray(value)) return summarize(value);
  const [start, end = value.length] = range ?? [];
  const offset = start ?? 0;
  const list = value.slice(offset, end);
  if (list.length > 0 && (isNumbers(list) || isBooleans(list))) {
    const stride = Math.ceil(list.length / maxPoints);
    return { length: list.length, offset, stride, values: roundAll(downsample(list, stride)) };
  }
  if (isMatrix(list, isNumbers) || isMatrix(list, isBooleans)) {
    const columns = Math.max(...list.map(row => row.length));
    // Keep about √maxPoints rows, or more when there are few columns, and spend the rest on columns
    const keptRows = Math.min(list.length, Math.max(Math.sqrt(maxPoints), maxPoints / columns));
    const rowStride = Math.ceil(list.length / keptRows);
    const columnStride = Math.ceil(columns / Math.max(1, Math.floor(maxPoints / Math.ceil(list.length / rowStride))));
    return {
      shape: [list.length, columns], offset, stride: [rowStride, columnStride],
      values: downsample(list, rowStride).map(row => roundAll(downsample(row, columnStride))),
    };
  }
  return { length: list.length, offset, items: list.slice(0, maxPoints).map(summarize) };
};

// The keys under the first level with more than one, with the size of each one's summary
const describeParts = (value, path = '') => {
  let prefix = path ? path + '.' : '';
  while (isObject(value) && Object.keys(value).length === 1) {
    const [key, item] = Object.entries(value)[0];
    prefix += key + '.';
    value = item;
  }
  if (!isObject(value)) return undefined;
  return Object.entries(value).slice(0, MAX_KEYS)
    .map(([key, item]) => `${prefix}${key} (${JSON.stringify(summarize(item)).length} chars)`).join(', ');
};

const getAnalysis = async (api, { accession, name, path, range, maxPoints = 200 }) => {
  // A missing analysis answers 404 with the names of the ones the project has
  const data = await api(`projects/${encodeURIComponent(accession)}/analyses/${encodeURIComponent(name)}`);
  const result = path ? selectPart(data, path, range, maxPoints) : summarize(data);
  const length = JSON.stringify(result).length;
  if (length > MAX_CHARS) {
    const parts = describeParts(path ? getAt(data, path) : data, path);
    throw new Error(`The result is ${length} characters long. ` +
      (parts ? `Read a part of it with path: ${parts}` : 'Ask for a shorter range or fewer maxPoints'));
  }
  return result;
};

module.exports = { summarize, selectPart, getAnalysis };
