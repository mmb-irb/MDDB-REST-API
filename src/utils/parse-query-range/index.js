// Regexp formats for string patterns search
const STEP_FORMAT = /^(?<start>\d+):(?<end>-?\d+)(:(?<step>\d+))?$/;
const RE = /(^(?<simple>\d+)$)|(^(?<start>\d+)-(?<end>\d+)$)/;

// Standard HTTP response status codes
const { BAD_REQUEST } = require('../status-codes');

// Set an error to be returned when ranges are requested with any 0 value
const zeroError = {
  headerError: BAD_REQUEST,
  error: `Ranges are 1-based so 0 is not supported`
};

// Given an array of unique sorted indices, pack them in start-end objects
// e.g. 1,2,3,5 -> { start: 1, end: 3 }, { start: 5, end: 5 }
const rangeIndices = indices => {
  // Transform all the "sorted" values, which are integers, into a specific format string
  // Join all values into a single string separated by comas
  // Merge consecutive indices into ranges
  let lastIndex;
  let lasti = 0;
  const entries = Object.entries(indices);
  const ranges = []
  for (const [i, index] of entries) {
    // Skip this index if it was already included in the last range
    if (i < lasti) continue;
    lasti += 1;
    lastIndex = index;
    // Iterate over the following indices to check if they are consecutive
    for (let j = lasti; j < entries.length; j++) {
      const nextIndex = entries[j][1];
      if (nextIndex !== lastIndex + 1) break;
      lastIndex = nextIndex;
      lasti += 1;
    }
    // Add the next index
    ranges.push({ start: index, end: lastIndex });
  }
  // Return the range string after removing the first coma
  return ranges;
}

// Given an array of unique sorted indices, write them in ranged notation
// e.g. 1,2,3,5 -> '1-3,5'
const rangeNotation = indices => {
  let rangedNotation = '';
  // Iterate range blocks
  const rangedIndices = rangeIndices(indices)
  rangedIndices.forEach(r => {
    rangedNotation += r.start.toString();
    if (r.end !== r.start) rangedNotation += `-${r.end}`;
    rangedNotation += ','
  })
  // Remove last coma
  return rangedNotation.slice(0,-1);
}

// Set an error to be returned when ranges exceed the limit
const beyondLimitError = (end, limit, dimensionName) => ({
  headerError: BAD_REQUEST,
  error: `End of requested ${dimensionName} (${end}) is beyond the limit (${limit})`
});

// Parse a query string with ranged meaning to a list of objects with start and end fields
// Accepted input string formats are start:end:step and e.g. 1,2,3-7
// If values beyond the limit are requested then an error is returned
// Note that range numbers are converted from 1-based to 0-based by substracting 1
// WARNING: Never expand ranges before checking the limit
// WARNING: Otherwise a single request (e.g. 1-99999999999) runs the API out of memory
const parseQueryRange = (string, limit, dimensionName) => {
  // Search in the function's parameter value "string" by using a specified regexp format: STEP_FORMAT
  const stepFormatParsed = STEP_FORMAT.exec(string);
  // Define the variable where requested values will be saved as start-end intervals (both included)
  const intervals = [];
  // The regexp format STEP_FORMAT has 3 defined groups: start, end and step
  // If the regexp search returns a result, use the value from the 3 groups to define and save the desired indices
  if (stepFormatParsed) {
    const start = +stepFormatParsed.groups.start;
    if (start === 0) return zeroError;
    let end = +stepFormatParsed.groups.end;
    // If the end is negative then "flip" the meaning and start counting from the end
    if (end < 0) end = limit + 1 + end;
    // If the end is less than the start then just use the start
    if (end < start) end = start;
    // If no "step" group is found then step is 1
    const step = +(stepFormatParsed.groups.step || 1);
    if (step === 0) return {
      headerError: BAD_REQUEST,
      error: `Step in the selection of ${dimensionName} (${string}) must be greater than 0`
    };
    // If the step is 1 then simply use the range
    if (step === 1) intervals.push([start, end]);
    else {
      // Return error if the last value exceeds the limit before adding every value
      const last = start + Math.floor((end - start) / step) * step;
      if (last > limit) return beyondLimitError(last, limit, dimensionName);
      for (let index = start; index <= end; index += step) {
        intervals.push([index, index]);
      }
    }
  }
  // If the initial regexp search returns no results, there is an alternative regexp format
  else {
    // First, split the string by comas
    for (const part of string.split(',')) {
      // Searcin each string fragment using the rexexp format "RE"
      const extracted = RE.exec(part);
       // If there are no results then it means the request is not supported
      if (!extracted) return {
        headerError: BAD_REQUEST,
        error: `Selection of ${dimensionName} (${part}) not suported. Use either start:end:step or 1,2,3-7 formats.`
      };
      // The regexp format RE has 3 defined groups: simple, start, and end
      // Save the "simple" group value and push it to the "intervals" array if it is an integer
      const simple = +extracted.groups.simple;
      if (Number.isInteger(simple)) {
        intervals.push([simple, simple]);
        continue;
      }
      // Use the start and end groups to define and save the desired indices
      const start = +extracted.groups.start;
      // If the end is less than the start then just use the start
      const end = Math.max(+extracted.groups.end, start);
      intervals.push([start, end]);
    }
  }
  // Check no 0 was requested
  if (intervals.some(([start]) => start === 0)) return zeroError;
  // Return error if the range end exceeds the limit
  // DANI: Antes se filtraban los valores mayores que el límite y arreglado
  // DANI: Sin embargo esto podía dar lugar a trayectorias más cortas de lo esperado silenciosamente
  const end = intervals.reduce((max, [, end]) => Math.max(max, end), 0);
  if (end > limit) return beyondLimitError(end, limit, dimensionName);
  // Sort intervals and merge those which overlap or are consecutive, without expanding them
  // Substract 1 from every value to convert them from 1-based to 0-based
  intervals.sort((a, b) => a[0] - b[0]);
  const ranges = [];
  for (const [start, end] of intervals) {
    const lastRange = ranges[ranges.length - 1];
    if (lastRange && start - 1 <= lastRange.end + 1) lastRange.end = Math.max(lastRange.end, end - 1);
    else ranges.push({ start: start - 1, end: end - 1 });
  }
  return ranges;
};

module.exports = {
  parseQueryRange,
  rangeIndices,
  rangeNotation
};
