// Generate a mmCIF file from a standard topology and coordinates from a specific frame

// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR } = require("../../../../utils/status-codes");
// The mmCIF needs the same topology fields than the PDB, plus the residue reference numbers
const { TOPOLOGY_FIELDS: PDB_TOPOLOGY_FIELDS } = require('../produce-pdb');
// Tools to write the structure in chunks
const {
    alignCells, alignCellsArray, getCoordinateWidth, getAlignedLength, streamLines, joinChunks, getTargetAtomIndices
} = require('../stream-lines');

// Set the flag mmCIF uses to state missing values
const MMCIF_MISSING_VALUE = '?';

// Atom site fields, in the same order than the RCSB mmCIF files
// Note that the MDDB workflow mmCIF parser relies on this order
const ATOM_SITE_FIELDS = [
    'group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id',
    'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy',
    'B_iso_or_equiv', 'pdbx_formal_charge', 'auth_seq_id', 'auth_comp_id', 'auth_asym_id', 'auth_atom_id',
    'pdbx_PDB_model_num',
];

// Format a value to be written in mmCIF
// Missing values are replaced by the missing flag and values which could be misread are quoted
const formatValue = value => {
    if (value === undefined || value === null || value === '') return MMCIF_MISSING_VALUE;
    const text = value.toString();
    // Values which are reserved words, start with a special character or include whitespaces must be quoted
    // Values including quotes are quoted as well, as RCSB does
    const mustBeQuoted = text === '.' || text === '?' || /^[_#$;[\]]/.test(text) || /[\s'"]/.test(text)
        || /^(data|loop|save|global|stop)_/i.test(text);
    if (!mustBeQuoted) return text;
    // Use double quotes if the value includes single quotes (e.g. O5' in nucleic acids)
    return text.includes("'") ? `"${text}"` : `'${text}'`;
};

// Optionally you may pass a selection of atom indices to filter
// The data name is used to name the mmCIF data block
// If the length is requested then all fields are padded to a fixed width, so all atom lines have the same length
// This way the length of the file is known in advance
// Return the expected length (if requested) and a generator of chunks (buffers) with the file content
const streamMmcif = (topologyData, frameCoordinates, atomIndices, dataName = 'structure', withLength = false) => {
    // Make sure we have as many coordinates as atoms to be written
    const nAtoms = atomIndices ? atomIndices.length : topologyData['atom_names'].length;
    if (frameCoordinates.length !== nAtoms) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'Number of frame coordinates and expected atoms does not match'
    };
    const targetAtomIndices = getTargetAtomIndices(atomIndices, nAtoms);
    // Set the data block header and the atom site loop header
    // Data block names can not include whitespaces
    const header = `data_${dataName.replace(/\s/g, '_')}\n#\n` +
        '# MDDB API produced mmCIF file\n#\n' +
        'loop_\n' + ATOM_SITE_FIELDS.map(field => `_atom_site.${field}\n`).join('');
    const tail = '#\n';
    // Format every different atom name and element only once
    const atomNames = topologyData['atom_names'];
    const atomElements = topologyData['atom_elements'];
    const atomNameCells = new Map();
    const atomElementCells = new Map();
    for (const atomIndex of targetAtomIndices) {
        const atomName = atomNames[atomIndex];
        if (!atomNameCells.has(atomName)) atomNameCells.set(atomName, formatValue(atomName));
        const atomElement = atomElements[atomIndex];
        if (!atomElementCells.has(atomElement)) atomElementCells.set(atomElement, formatValue(atomElement));
    }
    // Format the residue fields once per residue
    // There are two residue numerations:
    // The author numeration, which may have been renumbered for coherence, is written in the author fields
    // The reference (UniProt) numeration is written in the label fields
    // Residues with no reference numeration (e.g. not proteins) use the author numeration also in the label fields
    // Note that NGL reads the author fields, so NGL selections use the author numeration
    const residueNumbers = topologyData['residue_numbers'];
    const referenceNumbers = topologyData['residue_reference_numbers'];
    const residueIcodes = topologyData['residue_icodes'];
    const residueChainIndices = topologyData['residue_chain_indices'];
    const residueNameCells = topologyData['residue_names'].map(formatValue);
    const authorNumberCells = residueNumbers.map(formatValue);
    const labelNumberCells = residueNumbers.map((authorNumber, residueIndex) => {
        const referenceNumber = referenceNumbers && referenceNumbers[residueIndex];
        return formatValue(referenceNumber === undefined || referenceNumber === null ? authorNumber : referenceNumber);
    });
    const icodeCells = residueNumbers.map((_, residueIndex) => formatValue(residueIcodes && residueIcodes[residueIndex]));
    // Note that, unlike in PDB, chain names in mmCIF are not limited to one character
    let chainNameCells = topologyData['chain_names'].map(formatValue);
    // Get the coordinates width
    let coordinateWidth = 0;
    const aligned = withLength;
    // Pad all fields to the width of their widest value
    // Text fields are left aligned and numeric fields are right aligned
    if (aligned) {
        alignCells(atomNameCells, 'end');
        alignCells(atomElementCells, 'end');
        coordinateWidth = getCoordinateWidth(frameCoordinates);
        chainNameCells = alignCellsArray(chainNameCells, 'end');
    }
    const alignResidueCells = (cells, side) => aligned ? alignCellsArray(cells, side) : cells;
    const residueNames = alignResidueCells(residueNameCells, 'end');
    const authorNumbers = alignResidueCells(authorNumberCells, 'start');
    const labelNumbers = alignResidueCells(labelNumberCells, 'start');
    const icodes = alignResidueCells(icodeCells, 'end');
    // Join the residue fields which are written together
    // There is no entity id
    const residueLabelCells = residueNames.map((residueName, residueIndex) => {
        const chainName = chainNameCells[residueChainIndices[residueIndex]];
        return `${residueName} ${chainName} ${MMCIF_MISSING_VALUE} ${labelNumbers[residueIndex]} ${icodes[residueIndex]} `;
    });
    const residueAuthorCells = residueNames.map((residueName, residueIndex) => {
        const chainName = chainNameCells[residueChainIndices[residueIndex]];
        return `${authorNumbers[residueIndex]} ${residueName} ${chainName} `;
    });
    // Note that, unlike in PDB, atom serials in mmCIF have no width limit
    const serialWidth = aligned ? String(nAtoms).length : 0;
    const atomResidueIndices = topologyData['atom_residue_indices'];
    // Write a line for a given atom
    // There is no alternate location or formal charge, and there is a single model
    // Occupancy and temp factor are placeholders
    const formatLine = count => {
        const atomIndex = targetAtomIndices[count];
        const residueIndex = atomResidueIndices[atomIndex];
        const atomName = atomNameCells.get(atomNames[atomIndex]);
        const atomElement = atomElementCells.get(atomElements[atomIndex]);
        const serial = String(count + 1).padStart(serialWidth);
        const [ xCoord, yCoord, zCoord ] = frameCoordinates[count].map(coord => coord.toFixed(3).padStart(coordinateWidth));
        return `ATOM ${serial} ${atomElement} ${atomName} . ${residueLabelCells[residueIndex]}` +
            `${xCoord} ${yCoord} ${zCoord} 1.00 0.00 ${MMCIF_MISSING_VALUE} ` +
            `${residueAuthorCells[residueIndex]}${atomName} 1\n`;
    };
    const length = withLength ? getAlignedLength({ header, tail, nLines: nAtoms, formatLine }) : undefined;
    return streamLines({ header, tail, nLines: nAtoms, formatLine, length });
};

// Produce the whole mmCIF content as a string
// Arguments are the same than in the stream function above
const produceMmcif = (...args) => {
    const streamed = streamMmcif(...args);
    if (streamed.error) return streamed;
    return joinChunks(streamed);
};
produceMmcif.stream = streamMmcif;

// Topology fields read to build the mmCIF
// The structure route loads only these, since loading the whole topology is slow for big systems
produceMmcif.TOPOLOGY_FIELDS = new Set([...PDB_TOPOLOGY_FIELDS, 'residue_reference_numbers']);

module.exports = produceMmcif;
