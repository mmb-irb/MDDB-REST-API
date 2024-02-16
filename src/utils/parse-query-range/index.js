// Regexp formats for string patterns search
const STEP_FORMAT = /^(?<start>\d+):(?<end>\d+)(:(?<step>\d+))?$/;
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
  let lastIndex = 0;
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

// Parse a query string with ranged meaning to a list of objects with start and end fields
// Accepted input string formats are start:end:step and e.g. 1,2,3-7
// If a limit is passed then values beyond this limit are filtered
// Note that range numbers are converted from 1-based to 0-based by substracting 1
const parseQueryRange = (string, limit) => {
  // Search in the function's parameter value "string" by using a specified regexp format: STEP_FORMAT
  const stepFormatParsed = STEP_FORMAT.exec(string);
  // Define the variable where indices will be saved
  const accumulated = [];
  // The regexp format STEP_FORMAT has 3 defined groups: start, end and step
  // If the regexp search returns a result, use the value from the 3 groups to define and save the desired indices
  if (stepFormatParsed) {
    const start = +stepFormatParsed.groups.start;
    if (start === 0) return zeroError;
    const end = Math.max(+stepFormatParsed.groups.end, start); // If the end is less than the start then just use the start
    const step = +(stepFormatParsed.groups.step || 1); // If no "step" group is found then step is 1
    // If the step is 1 then simply use the range
    if (step === 1) return [{ start: start - 1, end: end - 1 }];
    for (let index = start; index <= end; index += step) {
      accumulated.push(index);
    }
    // If the initial regexp search returns no results, there is an alternative regexp format
  } else {
    // First, split the string by comas
    for (const part of string.split(',')) {
      // Searcin each string fragment using the rexexp format "RE"
      const extracted = RE.exec(part);
       // If there are no results then it means the request is not supported
      if (!extracted) return {
        headerError: BAD_REQUEST,
        error: `Selection "${part}" not suported. Use either start:end:step or 1,2,3-7 formats.`
      };
      // The regexp format RE has 3 defined groups: simple, start, and end
      // Save the "simple" group value and push it to the "accumulated" array if it is an integer
      const simple = +extracted.groups.simple;
      if (Number.isInteger(simple)) {
        accumulated.push(simple);
        continue;
      }
      // Use the start and end groups to define and save the desired indices
      const start = +extracted.groups.start;
      const end = Math.max(+extracted.groups.end, start); // If the end is less than the start then just use the start
      for (let index = start; index <= end; index++) {
        accumulated.push(index);
      }
    }
  }
  // Remove duplicates while checking no 0 was requested
  const set = new Set(accumulated);
  if (set.has(0)) return zeroError;
  const unique = Array.from(set);
  // Remove values beyond the limi
  const limited = limit ? unique.filter(v => v < limit) : unique;
  // Sort values
  const sorted = limited.sort((a, b) => a - b);
  // Substract 1 from every value to convert them from 1-based to 0-based
  const zeroBased = sorted.map(i => i - 1);
  // Return ranged indices
  return rangeIndices(zeroBased);
};

module.exports = {
  parseQueryRange,
  rangeIndices
};
