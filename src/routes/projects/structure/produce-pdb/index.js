

// Generate a pdb file from a standard topology and coordinates from a specific frame

// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR } = require("../../../../utils/status-codes");
// Tools to write the structure in chunks
const {
    streamLines, joinChunks, getTargetAtomIndices
} = require('../stream-lines');

// Optionally you may pass a selection of atom indices to filter
// The data name is not used in PDB, it is accepted only to have the same arguments than the mmCIF
// If the length is requested then the length of the file is calculated in advance
// Return the expected length (if requested) and a generator of chunks (buffers) with the file content
const streamPdb = (topologyData, frameCoordinates, atomIndices, dataName, withLength = false) => {
    // Make sure we have as many coordinates as atoms to be written
    const nAtoms = atomIndices ? atomIndices.length : topologyData['atom_names'].length;
    if (frameCoordinates.length !== nAtoms) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'Number of frame coordinates and expected atoms does not match'
    };
    const targetAtomIndices = getTargetAtomIndices(atomIndices, nAtoms);
    // Start by adding a REMARK
    const header = 'REMARK MDDB API produced PDB file\n';
    const tail = '';
    // Format every different atom name and element only once
    const atomNames = topologyData['atom_names'];
    const atomElements = topologyData['atom_elements'];
    const atomNameCells = new Map();
    const atomElementCells = new Map();
    for (const atomIndex of targetAtomIndices) {
        const atomName = atomNames[atomIndex];
        if (!atomNameCells.has(atomName)) {
            let pdbAtomName;
            if (atomName.length < 4) pdbAtomName = ' ' + atomName.padEnd(3, ' ');
            else if (atomName.length === 4) pdbAtomName = atomName;
            // Atom name should never be longer than 4 characters, but just in case
            else pdbAtomName = atomName.slice(0, 4);
            atomNameCells.set(atomName, pdbAtomName);
        }
        const atomElement = atomElements[atomIndex];
        if (!atomElementCells.has(atomElement)) atomElementCells.set(atomElement, atomElement.padStart(2, ' '));
    }
    // Format the residue fields once per residue
    const residueIcodes = topologyData['residue_icodes'];
    const residueNameCells = topologyData['residue_names'].map(residueName => {
        if (residueName) return residueName.padEnd(4, ' ');
        return 'XXX ';
    });
    const residueNumberCells = topologyData['residue_numbers'].map(residueNumber => {
        if (residueNumber) return residueNumber.toString(residueNumber > 9999 ? 16 : 10).padStart(4, ' ');
        return '   0';
    });
    const icodeCells = residueNameCells.map((_, residueIndex) => {
        const residueIcode = residueIcodes && residueIcodes[residueIndex];
        if (residueIcode) return residueIcode;
        return ' ';
    });
    // Use the chain name (letter) if it fits
    const chainNameCells = topologyData['chain_names'].map(chainName => {
        if (chainName && chainName.length === 1) return chainName;
        return 'X';
    });
    // Join the residue fields, which are written together
    const residueChainIndices = topologyData['residue_chain_indices'];
    const residueCells = residueNameCells.map((residueName, residueIndex) => {
        const chainName = chainNameCells[residueChainIndices[residueIndex]];
        return `${residueName}${chainName}${residueNumberCells[residueIndex]}${icodeCells[residueIndex]}`;
    });
    // Set placeholders for the occupancy and the temp factor
    const occupancy = '1.00';
    const tempFactor = '0.00';
    const atomResidueIndices = topologyData['atom_residue_indices'];
    // Write a line for a given atom
    const formatLine = count => {
        const atomIndex = targetAtomIndices[count];
        const pdbAtomName = atomNameCells.get(atomNames[atomIndex]);
        const pdbAtomElement = atomElementCells.get(atomElements[atomIndex]);
        const residueCell = residueCells[atomResidueIndices[atomIndex]];
        const [ xCoord, yCoord, zCoord ] = frameCoordinates[count].map(coord => coord.toFixed(3).padStart(8));
        // Wrap the displayed serial to 1 after 99999 to keep its five-column field fixed.
        const pdbCount = (count % 99999 + 1).toString().padStart(5, ' ');
        return `ATOM  ${pdbCount} ${pdbAtomName} ${residueCell}   ${xCoord}${yCoord}${zCoord}` +
            `  ${occupancy}  ${tempFactor}          ${pdbAtomElement}\n`;
    };
    // PDB fields have a fixed width and lines are 79 bytes long (including the line break)
    // However some values may not fit in their fields (e.g. coordinates over 9999.999) so lines may be longer
    // Sum the length of every line using the length of the formatted cells
    let length;
    if (withLength) {
        // Get the length of the line without the variable cells (i.e. atom name, residue, coordinates and element)
        const fixedLength = 79 - 4 - 10 - 3 * 8 - 2;
        const atomNameLengths = new Map([...atomNameCells].map(([ value, cell ]) => [ value, Buffer.byteLength(cell) ]));
        const atomElementLengths = new Map([...atomElementCells].map(([ value, cell ]) => [ value, Buffer.byteLength(cell) ]));
        const residueLengths = residueCells.map(cell => Buffer.byteLength(cell));
        // Coordinates are 8 characters long unless they do not fit
        const getCoordinateLength = coord => coord < 9999.999 && coord > -999.999
            ? 8 : Math.max(8, coord.toFixed(3).length);
        length = Buffer.byteLength(header) + Buffer.byteLength(tail) + nAtoms * fixedLength;
        for (let count = 0; count < nAtoms; count++) {
            const atomIndex = targetAtomIndices[count];
            const [ xCoord, yCoord, zCoord ] = frameCoordinates[count];
            length += atomNameLengths.get(atomNames[atomIndex]) + atomElementLengths.get(atomElements[atomIndex])
                + residueLengths[atomResidueIndices[atomIndex]]
                + getCoordinateLength(xCoord) + getCoordinateLength(yCoord) + getCoordinateLength(zCoord);
        }
    }
    return streamLines({ header, tail, nLines: nAtoms, formatLine, length });
};

// Produce the whole PDB content as a string
// Arguments are the same than in the stream function above
const producePdb = (...args) => {
    const streamed = streamPdb(...args);
    if (streamed.error) return streamed;
    return joinChunks(streamed);
};
producePdb.stream = streamPdb;

// Topology fields read to build the PDB
// The structure route loads only these, since loading the whole topology is slow for big systems
producePdb.TOPOLOGY_FIELDS = new Set([
    'atom_names', 'atom_elements', 'atom_residue_indices',
    'residue_names', 'residue_numbers', 'residue_icodes', 'residue_chain_indices',
    'chain_names',
]);

module.exports = producePdb;
