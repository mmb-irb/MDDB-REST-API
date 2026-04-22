const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
const { PROTEIN_RESIDUE_NAME_LETTERS, KNOWLEDGE_REFERENCE_KEYWORD } = require('../../../utils/constants');
const {
    caluclateMeanAndStandardDeviation,
    min, max, round2tenths, getHost
} = require('../../../utils/auxiliar-functions');

// Instantiate the router
const router = Router({ mergeParams: true });

// These values were taken from a paper as reference values
// 
// Set reference values for every aminoacid to be consider as 100% exposed
// This are necessary to calculate relative exposure
// LORE: Values were originally obtained from a paper suffested by Adam Bellaiche:
// LORE: DOI:10.1016/0022-2836(87)90038-6, table 2
// LORE: paper_values = { A: 113, R: 241, N: 158, D: 151, C: 140, Q: 189, E: 183, G: 85, H: 194, I: 182,
// LORE:     L: 180, K: 211, M: 204, F: 218, P: 143, S: 122, T: 146, W: 259, Y: 229, V: 160 }
// LORE: Previous values did not work well since we were having relative SAS values higher than 100%
// LORE: One possible explanation is that they were calculated with a different SASA method
// LORE: To keep values coherent, a new table was calculated using Gromacs' SAS
// LORE: Another important difference is that new values were calculated using naked aminoacids
// LORE: In the other hand, previous values were calculated using Gly-X-Gly pepetides
const EXPOSED_RESIDUE_REFERENCE_VALUES = { M: 319.2, K: 332.6, L: 306.8, N: 279.7, V: 262.7,
    I: 312.0, A: 224.9, F: 352.1, Q: 311.9, Y: 360.0, P: 258.2, R: 360.4, C: 249.6, E: 310.4,
    S: 242.6, D: 285.4, H: 314.3, T: 262.8, G: 198.5, W: 387.1
}

// Functions below return analysis data according to the FunPDBe schema
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_schema.json
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_example.json

// PDBe knowledge SASA
router.route('/').get( handler({ async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Get the PDB id in the request
    const pdbId = request.params.pdbid;
    // Get the PDB reference data
    const referenceData = await database.getReferenceData('pdbs', pdbId);
    if (referenceData.error) return referenceData;
    // Make sure the reference data has the expected SAS data field
    // Otherwise it may mean this is an old formatted reference, thus not having the data
    if (!referenceData.chain_sas) return {
        headerError: NOT_FOUND,
        error: `PDB reference ${pdbId} has no SAS data.`
    }
    // We must anotate data in PDB reference PDB chains and residues
    // Get chain data according to the FunPDBe schema
    const pdbChains = [];
    // If the requested project is the reference keyword then set the analyses available for this specific reference data
    // This was specifically tailored to get a reference SASA value
    const isReference = request.params.project === KNOWLEDGE_REFERENCE_KEYWORD
    if (isReference) {
        // Iterate over the different PDB chains
        for (const [chainLetter, sequence] of Object.entries(referenceData.chain_seq)) {
            // Get other values from this chain
            const residueSasValues = referenceData.chain_sas[chainLetter];
            const residueUniprotNumeration = referenceData.chain_resnum[chainLetter];
            // If the UniProt was not matched to the sequence (not usual) then skip this chain
            // We could return the values anyway but probably there is something wrong
            if (residueUniprotNumeration === 'Missmatched') continue;
            // Get residue data according to the FunPDBe schema
            const pdbResidues = [];
            // Iterate residue indices
            [...sequence].forEach((residueLetter, residueIndex) => {
                // Get the residue numeration according to the reference (uniprot and thus the PDB)
                const residueNumber = residueUniprotNumeration[residueIndex];
                // Get residue name
                const residueName = PROTEIN_LETTER_RESIDUE_NAMES[residueLetter] || 'NAN';
                // Get the SAS value for this residue
                const sasValue = residueSasValues[residueIndex];
                // Calculate how much exposed is the residue
                const exposedReferece = EXPOSED_RESIDUE_REFERENCE_VALUES[residueLetter];
                // Conditions stated by Adam Bellaiche
                // Buried: residues that maintain an RSA < 24%
                // Exposed: residues that consistently show RSA > 26%
                // Switching: residues with RSA values fluctuating between < 24% and > 26%
                // Borderline: residues with RSA values consistently between 24% and 26%
                const exposure = (sasValue / exposedReferece) * 100;
                let class_site_data_id;
                if (exposure <= 24) class_site_data_id = 2;
                else if (exposure >= 26) class_site_data_id = 1;
                else class_site_data_id = 4;
                // There will never be 'Switching' residues since data is not dynamic
                // Add current PDB residue to the list
                pdbResidues.push({
                    pdb_res_label: residueNumber.toString(),
                    aa_type: residueName,
                    additional_residue_annotations: {
                        mddb_rsa: {
                            value: round2tenths(exposure),
                        },
                    },
                    site_data: [{
                        "site_id_ref": class_site_data_id,
                        "confidence_classification": "high",
                    }],
                });
            })
            // Add the current PDB chain to the list
            pdbChains.push({
                chain_label: chainLetter,
                residues: pdbResidues
            })
        }
    }
    else {
        // Get the requested project data
        const project = await database.getProject();
        // If there was any problem then return the errors
        if (project.error) return project;
        // Query the database and retrieve the requested analysis
        const analysisData = await project.getAnalysisData('sasa');
        // If there was any problem then return the errors
        if (analysisData.error) return analysisData;
        // We will also need the topology data
        const topologyData = await project.getTopologyData();
        // If there was any problem then stop here
        if (topologyData.error) return topologyData;
        // Get the count of atoms per residue
        const atomCountPerResidue = {};
        topologyData.atom_residue_indices.forEach(residueIndex => {
            if (atomCountPerResidue[residueIndex]) atomCountPerResidue[residueIndex] += 1;
            else atomCountPerResidue[residueIndex] = 1;
        });
        // Iterate over the different PDB chains
        for (const [chainLetter, uniprotId] of Object.entries(referenceData.chain_uniprots)) {
            // Find the reference index in the topology
            const referenceIndex = topologyData.references.indexOf(uniprotId);
            // It may happen that the reference is not found
            // This means a different chain of this PDB was used to setup the MD system
            if (referenceIndex === -1) continue;
            // Get residue indices for residues which belong to this reference/chain
            const residueIndices = [];
            Object.entries(topologyData.residue_reference_indices).forEach(([residueIndex, residueReferenceIndex]) => {
                if (residueReferenceIndex === referenceIndex) residueIndices.push(residueIndex);
            });
            // Get residue data according to the FunPDBe schema
            const pdbResidues = [];
            // Iterate residue indices
            residueIndices.forEach(residueIndex => {
                // Get the residue numeration according to the reference (uniprot and thus the PDB)
                const residueNumber = topologyData.residue_reference_numbers[residueIndex];
                // Get residue name
                const residueName = topologyData.residue_names[residueIndex];
                // Get the amino acid single letter code
                const residueLetter = PROTEIN_RESIDUE_NAME_LETTERS[residueName];
                // Get the classic amino acid name
                // Otherwise the FunSchema validator will complain because a residue is called HID and it shoud be HIS.
                const classicResidueName = PROTEIN_LETTER_RESIDUE_NAMES[residueLetter] || 'NAN';
                // Get residue atom count
                const residueAtomCount = atomCountPerResidue[residueIndex];
                // Get residue SAS values for every frame in the analysis
                const saspf = analysisData.saspf[residueIndex];
                // Multiply the value by the number of atoms in the residue to 'un-normalize' them
                const absaspf = saspf.map(sas => sas * residueAtomCount);
                // Caluclate the mean and standard deviation of the new values
                const { mean, stdv } = caluclateMeanAndStandardDeviation(absaspf);
                // Get also min and max values
                const minAbsas = min(absaspf);
                const maxAbsas = max(absaspf);
                // Calculate how much exposed is the residue
                const exposedReferece = EXPOSED_RESIDUE_REFERENCE_VALUES[residueLetter];
                // Conditions stated by Adam Bellaiche
                // Buried: residues that maintain an RSA < 24%
                // Exposed: residues that consistently show RSA > 26%
                // Switching: residues with RSA values fluctuating between < 24% and > 26%
                // Borderline: residues with RSA values consistently between 24% and 26%
                const meanExposure = (mean / exposedReferece) * 100;
                const stdvExposure = (stdv / exposedReferece) * 100;
                const minExposure = (minAbsas / exposedReferece) * 100;
                const maxExposure = (maxAbsas / exposedReferece) * 100;
                let class_site_data_id;
                if (maxExposure <= 24) class_site_data_id = 2;
                else if (minExposure >= 26) class_site_data_id = 1;
                else if (minExposure > 24 && maxExposure < 26) class_site_data_id = 4;
                else class_site_data_id = 3;
                // Add current PDB residue to the list
                pdbResidues.push({
                    pdb_res_label: residueNumber.toString(),
                    aa_type: classicResidueName,
                    additional_residue_annotations: {
                        mddb_rsa: {
                            mean: round2tenths(meanExposure),
                            standard_deviation: round2tenths(stdvExposure),
                        },
                    },
                    site_data: [{
                        "site_id_ref": class_site_data_id,
                        "confidence_classification": "high",
                    }],
                });
            });
            // Add the current PDB chain to the list
            pdbChains.push({
                chain_label: chainLetter,
                residues: pdbResidues
            });
        }
    }
    
    // If no PDB chains were found then something is wrong
    if (pdbChains.length === 0) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'Something went wrong when searching for PDB chains'
    }
    // set the URL to the PDB website
    const pdbUrl = `https://www.ebi.ac.uk/pdbe/entry/pdb/${referenceData.id}`;
    // Get the requesting protocol, host and URL base
    // It will be used to generate the URLs
    const protocol = request.protocol;
    const host = getHost(request);
    // Add the cliente equivalent project URL as it has been suggested
    // HARDCODE: El host de la query no tiene por que ser el del cliente
    // HARDCODE: De hecho una API podría no tener cliente asociado o tener varios
    const url = isReference ? pdbUrl : `${protocol}://${host}/#/id/${request.params.project}/`;
    // Set the date in the expected format
    const date = new Date(referenceData.date);
    const funschemaDate = `${date.getMonth()}/${date.getDate()}/${date.getFullYear()}`;
    // Return the final response in the expected format
    return {
        data_resource: "MDDB",
        resource_version: "0.0",
        resource_entry_url: url,
        model_coordinates_url: pdbUrl,
        release_date: funschemaDate,
        pdb_id: referenceData.id,
        additional_entry_annotations: {
            source_id: request.params.project,
        },
        chains: pdbChains,
        evidence_code_ontology: [{
            "eco_term": "molecular dynamics evidence used in automatic assertion",
            "eco_code": "ECO_0006373",
        }],
        sites: [
            {
                site_id: 1,
                //label: "Exposed residue (RSA > 26% all the time)",
                label: "Exposed",
                additional_site_annotations: { percentage: "26" },
            },
            {
                site_id: 2,
                //label: "Buried residue (RSA < 24% all the time)",
                label: "Buried",
                additional_site_annotations: { percentage: "24" },
            },
            {
                site_id: 3,
                label: "Switching residue (fluctuating between < 24% and > 26%)",
                label: "Switching",
                additional_site_annotations: { percentage: "24-26" },
            },
            {
                site_id: 4,
                label: "Borderline residue (between < 24% and > 26% all the time)",
                label: "Borderline",
                additional_site_annotations: { percentage: "24-26" },
            },
        ],
    };
}}));

module.exports = router;