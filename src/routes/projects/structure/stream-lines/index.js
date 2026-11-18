// Tools to write structure files (PDB, mmCIF) line by line in chunks, instead of building the whole file in memory
// The file size may be calculated before writing it, which allows to send the content length header

// Number of atom lines written in every chunk
const LINES_PER_CHUNK = 10000;

// Pad a text up to a width in bytes, which is not the same than characters for non-ASCII texts
// The side is the side where the padding is added: 'start' (right aligned) or 'end' (left aligned)
const pad = (text, width, side) => {
    const padding = ' '.repeat(width - Buffer.byteLength(text));
    return side === 'start' ? padding + text : text + padding;
};

// Given a map of values and cells (i.e. formatted values), pad all cells to the width of the widest one
// Cells are modified in place
const alignCells = (cells, side) => {
    let width = 0;
    for (const cell of cells.values()) width = Math.max(width, Buffer.byteLength(cell));
    for (const [ value, cell ] of cells) cells.set(value, pad(cell, width, side));
};

// Same as above but for an array of cells
const alignCellsArray = (cells, side) => {
    let width = 0;
    for (const cell of cells) width = Math.max(width, Buffer.byteLength(cell));
    return cells.map(cell => pad(cell, width, side));
};

// Get the width of the widest coordinate once written with 3 decimals
// Note that the widest positive and negative coordinates are the greatest and the lowest
// Non finite coordinates (NaN or Infinity) are written as they are, so their width is considered as well
const getCoordinateWidth = frameCoordinates => {
    let min = 0;
    let max = 0;
    let width = 0;
    for (const coords of frameCoordinates) {
        for (const coord of coords) {
            if (coord < min) min = coord;
            else if (coord > max) max = coord;
            else if (!Number.isFinite(coord)) width = Math.max(width, coord.toFixed(3).length);
        }
    }
    return Math.max(width, min.toFixed(3).length, max.toFixed(3).length);
};

// Get the length in bytes of a file with a header, a line per atom and a tail, where all atom lines have the same length
// The format line function receives the index of the line (not the atom index) and returns the line text
const getAlignedLength = ({ header, tail, nLines, formatLine }) => {
    // All aligned lines have the same length, so we can measure the first one to know the length of all
    const lineLength = nLines > 0 ? Buffer.byteLength(formatLine(0)) : 0;
    return Buffer.byteLength(header) + nLines * lineLength + Buffer.byteLength(tail);
};

// Set the generator of chunks for a file with a header, a line per atom and a tail
// The format line function receives the index of the line (not the atom index) and returns the line text
// If the expected length of the whole file in bytes is passed then the number of produced bytes is checked against it
const streamLines = ({ header, tail, nLines, formatLine, length }) => {
    function* generateChunks () {
        let produced = 0;
        // Convert text to buffer and keep count of the produced bytes
        const toBuffer = text => {
            const buffer = Buffer.from(text, 'utf-8');
            produced += buffer.length;
            if (length !== undefined && produced > length)
                throw new Error(`Structure exceeds its expected length (${length} bytes)`);
            return buffer;
        };
        yield toBuffer(header);
        let lines = '';
        for (let line = 0; line < nLines; line++) {
            lines += formatLine(line);
            if ((line + 1) % LINES_PER_CHUNK !== 0) continue;
            yield toBuffer(lines);
            lines = '';
        }
        yield toBuffer(lines + tail);
        if (length !== undefined && produced !== length)
            throw new Error(`Structure length (${produced} bytes) does not match its expected length (${length} bytes)`);
    }
    return { length, chunks: generateChunks() };
};

// Join all chunks in a single string
const joinChunks = ({ chunks }) => Buffer.concat([...chunks]).toString('utf-8');

// Get the atom indices to be written in order
// Note that frame coordinates are returned in the atom indices order, since atom indices are sorted when querying them
const getTargetAtomIndices = (atomIndices, nAtoms) => {
    if (!atomIndices) return Array.from({ length: nAtoms }, (_, index) => index);
    return [ ...atomIndices ].sort((a, b) => a - b);
};

module.exports = {
    alignCells,
    alignCellsArray,
    getCoordinateWidth,
    getAlignedLength,
    streamLines,
    joinChunks,
    getTargetAtomIndices,
};
