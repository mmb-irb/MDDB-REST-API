// Copy a single path (already split in keys) from the source object into the target object
// Arrays are traversed like mongo does in projections (e.g. 'mds.name' keeps only the name of every MD)
// Return true if something was copied, so parents are created only when they are needed
const copyPath = (source, target, [ key, ...rest ]) => {
  if (source === null || typeof source !== 'object' || !(key in source)) return false;
  const value = source[key];
  if (rest.length === 0) {
    target[key] = value;
    return true;
  }
  if (Array.isArray(value)) {
    const children = target[key] || value.map(() => ({}));
    // Note that every item must be visited, so 'some' is not used directly
    const copied = value.map((item, index) => copyPath(item, children[index], rest)).some(Boolean);
    if (copied) target[key] = children;
    return copied;
  }
  const child = target[key] || {};
  const copied = copyPath(value, child, rest);
  if (copied) target[key] = child;
  return copied;
};

// Get a new object with only the requested field paths (e.g. 'metadata.NAME') of the source object
// Fields which are missing in the source object are skipped
const pickFields = (source, paths) => {
  const picked = {};
  for (const path of paths) copyPath(source, picked, path.split('.'));
  return picked;
};

module.exports = pickFields;
