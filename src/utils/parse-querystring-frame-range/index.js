const STEP_FORMAT = /^(?<start>\d+):(?<end>\d+)(:(?<step>\d+))?$/;
const RE = /(^(?<simple>\d+)$)|(^(?<start>\d+)-(?<end>\d+)$)/;

const sortingFn = (a, b) => a - b;

const parseQuerystringFrameRange = string => {
  const stepFormatParsed = STEP_FORMAT.exec(string);
  const accumulated = [];
  if (stepFormatParsed) {
    const start = +stepFormatParsed.groups.start;
    const end = Math.max(+stepFormatParsed.groups.end, start);
    const step = +(stepFormatParsed.groups.step || 1);
    for (let frame = start; frame <= end; frame += step) {
      accumulated.push(frame);
    }
  } else {
    for (const part of string.split(',')) {
      const extracted = RE.exec(part);
      if (!extracted) return;
      const simple = +extracted.groups.simple;
      if (Number.isInteger(simple)) {
        if (!simple) return; // can't have 0, bail early
        accumulated.push(simple);
        continue;
      }
      const start = +extracted.groups.start;
      if (!start) return; // can't have 0, bail early
      const end = Math.max(+extracted.groups.end, start);
      for (let frame = start; frame <= end; frame++) {
        accumulated.push(frame);
      }
    }
  }
  const sorted = Array.from(new Set(accumulated)).sort(sortingFn);
  if (accumulated[0] === 0) return; // can't be 0
  return (
    sorted.map(frame => `${frame - 1}-${frame - 1}`).join(',') || undefined
  );
};

module.exports = parseQuerystringFrameRange;
