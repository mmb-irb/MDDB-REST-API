

// Generate a pdb file from a standard topology and coordinates from a specific frame

// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR } = require("../../../../utils/status-codes");

// Optionally you may pass a selection of atom indices to filter
const producePdb = (topologyData, frameCoordinates, atomIndices) => {
    // Make sure we have as many coordinates as atoms to be written
    const nAtoms = atomIndices ? atomIndices.length : topologyData['atom_names'].length;
    if (frameCoordinates.length !== nAtoms) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'Number of frame coordinates and expected atoms does not match'
    };
    // Set target atom indices as a set
    const targetAtomIndices = atomIndices && new Set(atomIndices);
    // Start by adding a REMARK
    let pdbContent = 'REMARK MDDB API produced PDB file\n';
    // Iterate atoms and write a new line for every atom
    let count = 0;
    for (let atomIndex = 0; atomIndex < topologyData['atom_names'].length; atomIndex++) {
        // Skip this atom if it is not among the targeted atom indicies
        if (targetAtomIndices && !targetAtomIndices.has(atomIndex)) continue;
        // Get current atom topology values
        const atomName = topologyData['atom_names'][atomIndex];
        let pdbAtomName;
        if (atomName.length < 4) pdbAtomName = ' ' + atomName.padEnd(3, ' ');
        else if (atomName.length === 4) pdbAtomName = atomName;
        // Atom name should never be longer than 4 characters, but just in case
        else pdbAtomName = atomName.slice(0, 4);
        const atomElement = topologyData['atom_elements'][atomIndex];
        const pdbAtomElements = atomElement.padStart(2, ' ');
        // Get the atom residue index
        const residueIndex = topologyData['atom_residue_indices'][atomIndex];
        // Using the resiude index find its name, number and insertion code
        const residueName = topologyData['residue_names'][residueIndex];
        let pdbResidueName = 'XXX ';
        if (residueName) pdbResidueName = residueName.padEnd(4, ' ');
        const residueNumber = topologyData['residue_numbers'][residueIndex];
        let pdbResidueNumber = '   0';
        if (residueNumber) pdbResidueNumber = residueNumber.toString(residueNumber > 9999 ? 16 : 10).padStart(4, ' ');
        const residueIcode = topologyData['residue_icodes'] && topologyData['residue_icodes'][residueIndex];
        let pdbResidueIcode = ' ';
        if (residueIcode) pdbResidueIcode = residueIcode;
        // Get the chain index
        const chainIndex = topologyData['residue_chain_indices'][residueIndex];
        // Use the chain index to get the chain name (letter)
        const chainName = topologyData['chain_names'][chainIndex];
        let pdbChainName = 'X';
        if (chainName && chainName.length === 1) pdbChainName = chainName;
        // Get current atom coordinates
        const coords = frameCoordinates[count];
        const [ xCoord, yCoord, zCoord ] = coords.map(coord => coord.toFixed(3).padStart(8));
        // Set placeholders for the occupancy and the temp factor
        const occupancy = '1.00';
        const tempFactor = '0.00';
        // Add 1 to de count and set the PDB index according to the count
        count += 1;
        const pdbCount = count.toString().padStart(5, ' ');
        // Add the new line to the PDB content
        pdbContent += `ATOM  ${pdbCount} ${pdbAtomName} ${pdbResidueName}${pdbChainName}${pdbResidueNumber}` +
            `${pdbResidueIcode}   ${xCoord}${yCoord}${zCoord}  ${occupancy}  ${tempFactor}          ${pdbAtomElements}\n`;
    }
    // Return the final PDB content
    return pdbContent;
};

module.exports = producePdb;