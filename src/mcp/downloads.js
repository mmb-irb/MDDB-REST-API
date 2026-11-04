const { STRUCTURE_FORMATS, TRAJECTORY_FORMATS } = require('../utils/constants');

const DATA = ['structure', 'trajectory', 'coordinates', 'box', 'file'];
// The formats the structure and trajectory endpoints produce
const FORMATS = [...Object.keys(STRUCTURE_FORMATS), ...Object.keys(TRAJECTORY_FORMATS)];

const PATHS = { structure: 'structure', trajectory: 'trajectory', coordinates: 'trajectory/coordinates', box: 'trajectory/box' };
// The API names structure files after their format's extension, and trajectory files after their format
const extension = format => STRUCTURE_FORMATS[format]?.extension ?? format;

// Older API versions ignore arguments they don't support, so check what they serve instead of trusting the link
const getDownloadUrl = async (probe, args) => {
  const project = `projects/${encodeURIComponent(args.accession)}`;
  if (args.data === 'file') {
    if (!args.filename) throw new Error('Pass the filename, as get_project lists them');
    return probe(`${project}/files/${encodeURIComponent(args.filename)}`);
  }
  const { format, frames, selection, numbering, atoms, residues, chains } = args;
  const [download, numberingIgnored, selected, whole] = await Promise.all([
    probe(`${project}/${PATHS[args.data]}`,
      { format, frames, selection, numbering, atomindices: atoms, resindices: residues, chaindices: chains }),
    // An API that knows the argument rejects an unknown numbering
    numbering === 'uniprot' && probe(`${project}/structure`, { numbering: 'unknown' }).then(() => true, () => false),
    // An NGL selection the API can't parse gives the whole system, like one that matches every atom
    selection && probe(`${project}/structure`, { selection, numbering }),
    selection && probe(`${project}/structure`),
  ]);
  if (format && download.filename && !download.filename.endsWith('.' + extension(format))) {
    throw new Error(`This API served ${download.filename} instead of ${format}: its version does not support ${format}`);
  }
  if (numberingIgnored) {
    throw new Error('This API version ignores numbering, so residue numbers would be the author ones, not UniProt positions');
  }
  const matchedAll = selected && whole && selected.bytes !== undefined && selected.bytes === whole.bytes;
  return matchedAll
    ? { ...download, warning: 'The selection matched every atom: if it should not, the API could not parse it' }
    : download;
};

module.exports = { DATA, FORMATS, getDownloadUrl };
