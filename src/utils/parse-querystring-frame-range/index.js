// Regexp formats for string patterns search
const STEP_FORMAT = /^(?<start>\d+):(?<end>\d+)(:(?<step>\d+))?$/;
const RE = /(^(?<simple>\d+)$)|(^(?<start>\d+)-(?<end>\d+)$)/;

// Function which is passed to a sort() command
// Elements are sorted by number (e.g. 1,2,11) but not in an alphabetic way (e.g. 1,11,2)
const sortingFn = (a, b) => a - b;

const parseQuerystringFrameRange = string => {
  // Search in the function's parameter value "string" by using a specified regexp format: STEP_FORMAT
  const stepFormatParsed = STEP_FORMAT.exec(string);
  // Define the variable where frames will be saved
  const accumulated = [];
  // The regexp format STEP_FORMAT has 3 defined groups: start, end and step
  // If the regexp search returns a result, use the value from the 3 groups to define and save the desired frames
  if (stepFormatParsed) {
    const start = +stepFormatParsed.groups.start;
    const end = Math.max(+stepFormatParsed.groups.end, start); // If the end is less than the start then just use the start
    const step = +(stepFormatParsed.groups.step || 1); // If no "step" group is found then step is 1
    for (let frame = start; frame <= end; frame += step) {
      accumulated.push(frame);
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
      // Use the start and end groups to define and save the desired frames
      const start = +extracted.groups.start;
      if (!start) return; // If it is 0 then return here
      const end = Math.max(+extracted.groups.end, start); // If the end is less than the start then just use the start
      for (let frame = start; frame <= end; frame++) {
        accumulated.push(frame);
      }
    }
  }
  // Resave the accumulated array without duplicated values (Set) and sorted by number
  const sorted = Array.from(new Set(accumulated)).sort(sortingFn);
  // Return here if the first value of "accumulated" is 0
  if (accumulated[0] === 0) return; // If it is 0 then return here
  // Transform all the "sorted" values, which are integers, into a specific format string
  // Join all values into a single string separated by comas
  // Then returns this string. If can not perform last two procedures then return undefined
  return (
    sorted.map(frame => `${frame - 1}-${frame - 1}`).join(',') || undefined
  );
};

module.exports = parseQuerystringFrameRange;
