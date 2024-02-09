// Regexp formats for string patterns search
const STEP_FORMAT = /^(?<start>\d+):(?<end>\d+)(:(?<step>\d+))?$/;
const RE = /(^(?<simple>\d+)$)|(^(?<start>\d+)-(?<end>\d+)$)/;

// Function which is passed to a sort() command
// Elements are sorted by number (e.g. 1,2,11) but not in an alphabetic way (e.g. 1,11,2)
const sortingFn = (a, b) => a - b;

// Parse a query string with ranged meaning to a standard string with ranged meaning
// Accepted input string and conversion examples:
// start:end:step (e.g. 1:20:2 -> 1-1,3-3,5-5,7-7,etc)
// single,start-end (e.g. 20-40,45,60-82 -> 20-40,45-45,60-82)
// Output string
// e.g. 1-10,20-30
const parseQueryRange = string => {
  // Search in the function's parameter value "string" by using a specified regexp format: STEP_FORMAT
  const stepFormatParsed = STEP_FORMAT.exec(string);
  // Define the variable where indices will be saved
  const accumulated = [];
  // The regexp format STEP_FORMAT has 3 defined groups: start, end and step
  // If the regexp search returns a result, use the value from the 3 groups to define and save the desired indices
  if (stepFormatParsed) {
    const start = +stepFormatParsed.groups.start;
    const end = Math.max(+stepFormatParsed.groups.end, start); // If the end is less than the start then just use the start
    const step = +(stepFormatParsed.groups.step || 1); // If no "step" group is found then step is 1
    // If the step is 1 then simply use the range
    if (step === 1) return `${start - 1}-${end - 1}`;
    for (let index = start; index <= end; index += step) {
      accumulated.push(index);
    }
    // If the initial regexp search returns no results, there is an alternative regexp format
  } else {
    // First, split the string by comas
    for (const part of string.split(',')) {
      // Searcin each string fragment using the rexexp format "RE"
      const extracted = RE.exec(part);
      if (!extracted) return; // If there are no results then return here
      // The regexp format RE has 3 defined groups: simple, start, and end
      // Save the "simple" group value and push it to the "accumulated" array if it is an integer
      const simple = +extracted.groups.simple;
      if (Number.isInteger(simple)) {
        if (!simple) return; // If it is 0 then return here
        accumulated.push(simple);
        continue;
      }
      // Use the start and end groups to define and save the desired indices
      const start = +extracted.groups.start;
      if (!start) return; // If it is 0 then return here
      const end = Math.max(+extracted.groups.end, start); // If the end is less than the start then just use the start
      for (let index = start; index <= end; index++) {
        accumulated.push(index);
      }
    }
  }
  // Remove duplicated indices and sort them
  const sorted = Array.from(new Set(accumulated)).sort(sortingFn);
  // Return here if the first value is 0 (idk why, but this should not happen since first frame is 1 here)
  if (sorted[0] === 0) return; // If it is 0 then return here
  // Transform all the "sorted" values, which are integers, into a specific format string
  // Join all values into a single string separated by comas
  // Merge consecutive indices into ranges
  let range = '';
  let lastIndex = 0;
  let lasti = 0;
  const entries = Object.entries(sorted);
  for (const [i, index] of entries) {
    // Skip this index if it was already included in the last range
    if (i < lasti) continue;
    // Add the next index
    range += `,${index}`;
    lasti += 1;
    lastIndex = index;
    // Iterate over the following indices to check if they are consecutive
    for (let j = lasti; j < entries.length; j++) {
      const nextIndex = entries[j][1];
      if (nextIndex !== lastIndex + 1) break;
      lastIndex = nextIndex;
      lasti += 1;
    }
    range += `-${lastIndex}`;
  }
  // Return the range string after removing the first coma
  return range.substring(1) || undefined;
};

module.exports = parseQueryRange;
