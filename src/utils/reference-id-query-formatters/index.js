// Standard HTTP response status codes
const { BAD_REQUEST } = require('../status-codes');

// Set regular expressions for PDB's new accession formats
const PDB12 = new RegExp("^(pdb|PDB)_([0-9A-Za-z]{8})$");
const PDB12LEGACY = new RegExp("^(pdb|PDB)_0000([0-9A-Za-z]{4})$");
const PDB4 = new RegExp("^[0-9A-Za-z]{4}$");
// Set a query formatter to match both the new and the old formats, no matter which is the input format
const pdbIdQueryFormatter = id => {
    if (PDB4.test(id)) {
        const formattedPdb4 = id.toUpperCase();
        const formattedPdb12 = `pdb_0000${formattedPdb4}`;
        return { $in: [ formattedPdb4, formattedPdb12 ] };
    }
    if (PDB12LEGACY.test(id)) {
        const match = id.match(PDB12LEGACY);
        const rawPdb4 = match[2];
        const formattedPdb4 = rawPdb4.toUpperCase();
        const formattedPdb12 = `pdb_0000${formattedPdb4}`;
        return { $in: [ formattedPdb4, formattedPdb12 ] };
    }
    if (PDB12.test(id)) {
        const match = id.match(PDB12);
        const rawCode = match[2];
        const formattedPdb12 = `pdb_${rawCode.toUpperCase()}`;
        return formattedPdb12;
    }
    return {
        headerError: BAD_REQUEST,
        error: `Unrecognized PDB id format in "${id}"`
    };
}

// Given a specific reference configuration and a reference id, create the id query for it
const referenceIdQueryFormatter = (reference, referenceId) => {
    // If the reference has an specific formatter then use it
    if (reference.idQueryFormatter) return reference.idQueryFormatter(referenceId);
    // Otherwise return a generic query
    return referenceId;
}

// Export query formatters
module.exports = {
    pdbIdQueryFormatter,
    referenceIdQueryFormatter,
}