// Generate a mmCIF file from a standard topology and coordinates from a specific frame

// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR } = require("../../../../utils/status-codes");
// The mmCIF needs the same topology fields than the PDB, plus the residue reference numbers
const { TOPOLOGY_FIELDS: PDB_TOPOLOGY_FIELDS } = require('../produce-pdb');

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
const produceMmcif = (topologyData, frameCoordinates, atomIndices, dataName = 'structure') => {
    // Make sure we have as many coordinates as atoms to be written
    const nAtoms = atomIndices ? atomIndices.length : topologyData['atom_names'].length;
    if (frameCoordinates.length !== nAtoms) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'Number of frame coordinates and expected atoms does not match'
    };
    // Set target atom indices as a set
    const targetAtomIndices = atomIndices && new Set(atomIndices);
    // Start by the data block header and the atom site loop header
    // Data block names can not include whitespaces
    let mmcifContent = `data_${dataName.replace(/\s/g, '_')}\n#\n`;
    mmcifContent += '# MDDB API produced mmCIF file\n#\n';
    mmcifContent += 'loop_\n' + ATOM_SITE_FIELDS.map(field => `_atom_site.${field}\n`).join('');
    // Iterate atoms and write a new line for every atom
    let count = 0;
    for (let atomIndex = 0; atomIndex < topologyData['atom_names'].length; atomIndex++) {
        // Skip this atom if it is not among the targeted atom indicies
        if (targetAtomIndices && !targetAtomIndices.has(atomIndex)) continue;
        // Get current atom topology values
        const atomName = formatValue(topologyData['atom_names'][atomIndex]);
        const atomElement = formatValue(topologyData['atom_elements'][atomIndex]);
        // Get the atom residue index
        const residueIndex = topologyData['atom_residue_indices'][atomIndex];
        // Using the resiude index find its name, number and insertion code
        const residueName = formatValue(topologyData['residue_names'][residueIndex]);
        // There are two residue numerations:
        // The author numeration, which may have been renumbered for coherence, is written in the author fields
        // The reference (UniProt) numeration is written in the label fields
        // Residues with no reference numeration (e.g. not proteins) use the author numeration also in the label fields
        // Note that NGL reads the author fields, so NGL selections use the author numeration
        const authorNumber = topologyData['residue_numbers'][residueIndex];
        const referenceNumbers = topologyData['residue_reference_numbers'];
        const referenceNumber = referenceNumbers && referenceNumbers[residueIndex];
        const authorResidueNumber = formatValue(authorNumber);
        const labelResidueNumber = formatValue(referenceNumber === undefined || referenceNumber === null
            ? authorNumber : referenceNumber);
        const residueIcode = formatValue(topologyData['residue_icodes'] && topologyData['residue_icodes'][residueIndex]);
        // Get the chain index
        const chainIndex = topologyData['residue_chain_indices'][residueIndex];
        // Use the chain index to get the chain name
        // Note that, unlike in PDB, chain names in mmCIF are not limited to one character
        const chainName = formatValue(topologyData['chain_names'][chainIndex]);
        // Get current atom coordinates
        const coords = frameCoordinates[count];
        const [ xCoord, yCoord, zCoord ] = coords.map(coord => coord.toFixed(3));
        // Add 1 to de count and set the atom serial according to the count
        // Note that, unlike in PDB, atom serials in mmCIF have no width limit
        count += 1;
        // Add the new line to the mmCIF content
        // There is no alternate location, entity id or formal charge, and there is a single model
        // Occupancy and temp factor are placeholders
        mmcifContent += `ATOM ${count} ${atomElement} ${atomName} . ${residueName} ${chainName} ` +
            `${MMCIF_MISSING_VALUE} ${labelResidueNumber} ${residueIcode} ${xCoord} ${yCoord} ${zCoord} 1.00 0.00 ` +
            `${MMCIF_MISSING_VALUE} ${authorResidueNumber} ${residueName} ${chainName} ${atomName} 1\n`;
    }
    mmcifContent += '#\n';
    // Return the final mmCIF content
    return mmcifContent;
};

// Topology fields read to build the mmCIF
// The structure route loads only these, since loading the whole topology is slow for big systems
produceMmcif.TOPOLOGY_FIELDS = new Set([...PDB_TOPOLOGY_FIELDS, 'residue_reference_numbers']);

module.exports = produceMmcif;
