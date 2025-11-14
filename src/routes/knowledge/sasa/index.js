const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
const { PROTEIN_RESIDUE_NAME_LETTERS } = require('../../../utils/constants');
const {
    caluclateMeanAndStandardDeviation,
    min, max, round2tenths
} = require('../../../utils/auxiliar-functions');

// Instantiate the router
const router = Router({ mergeParams: true });


// Functions below return analysis data according to the FunPDBe schema
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_schema.json
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_example.json

// PDBe knowledge SASA
router.route('/').get( handler({ async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
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
    // Get the project reference data
    const referenceData = await project.getReferenceData();
    // If there was any problem then stop here
    if (referenceData.error) return referenceData;
    // Get the PDB id in hte request
    const pdbId = request.params.pdbid;
    // Filter PDB references
    const pdbReference = referenceData.find(reference => reference.ref_type === 'pdbs' && reference.id === pdbId);
    // Make sure we have PDB references
    if (!pdbReference) return {
        headerError: NOT_FOUND,
        error: `PDB reference ${pdbId} not found for project ${project.accession}`
    }
    // Get the count of atoms per residue
    const atomCountPerResidue = {};
    topologyData.atom_residue_indices.forEach(residueIndex => {
        if (atomCountPerResidue[residueIndex]) atomCountPerResidue[residueIndex] += 1;
        else atomCountPerResidue[residueIndex] = 1;
    });
    // Set the sites list to add further data
    const sites = [
        {
            site_id: 1,
            label: 'SAS mean',
            unit: 'Å²'
        },
        {
            site_id: 2,
            label: 'SAS standard deviation',
            unit: 'Å²'
        },
    ];
    // To do so we must anotate data in PDB reference PDB chains and residues
    // Get chain data according to the FunPDBe schema
    const pdbChains = [];
    // Iterate over the different PDB chains
    for (const [chainLetter, uniprotId] of Object.entries(pdbReference.chain_uniprots)) {
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
            // Get residue atom count
            const residueAtomCount = atomCountPerResidue[residueIndex];
            // Get residue SAS values for every frame in the analysis
            const saspf = analysisData.saspf[residueIndex];
            // Multiply the value by the number of atoms in the residue to 'un-normalize' them
            const absaspf = saspf.map(sas => sas * residueAtomCount);
            // Caluclate the mean and standard deviation of the new values
            const { mean, stdv } = caluclateMeanAndStandardDeviation(absaspf);
            // Get the residue 
            sites.push(
                {
                    site_id: site_count,
                    label: `${chainLetter} - ${residueName} ${residueNumber} SAS mean`
                },
                {
                    site_id: site_count + 1,
                    label: `${chainLetter} - ${residueName} ${residueNumber} SAS standard deviation`
                }
            );
            // Add current PDB residue to the list
            pdbResidues.push({
                pdb_res_label: residueNumber.toString(),
                aa_type: residueName,
                site_data: [
                    {
                        site_id_ref: 1,
                        raw_score: round2tenths(mean),
                        confidence_classification: "medium",
                    },
                    {
                        site_id_ref: 2,
                        raw_score: round2tenths(stdv),
                        confidence_classification: "medium",
                    }
                ],
            });
            // Add one to the site counter
            site_count += 2;
        })
        // Add the current PDB chain to the list
        pdbChains.push({
            chain_label: chainLetter,
            residues: pdbResidues
        })
    }
    // If no PDB chains were found then something is wrong
    if (pdbChains.length === 0) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'Something went wrong when searching for PDB chains'
    }
    // Return the final response in the expected format
    return {
        data_resource: "mddb_sasa",
        pdb_id: pdbReference.id,
        chains: pdbChains,
        sites: sites,
        evidence_code_ontology: [{
            "eco_term": "molecular dynamics evidence used in automatic assertion",
            "eco_code": "ECO_0006373"
        }],
    };
}}));

module.exports = router;