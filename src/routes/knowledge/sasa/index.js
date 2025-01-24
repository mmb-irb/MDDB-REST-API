const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');

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
    // Set the sites list to add further data
    let site_count = 1;
    const sites = [];
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
                    site_id_ref: site_count,
                    raw_score: analysisData.means[residueIndex],
                    raw_score_unit: 'Å²',
                    confidence_classification: "medium",
                },
                {
                    site_id_ref: site_count + 1,
                    raw_score: analysisData.stdvs[residueIndex],
                    raw_score_unit: 'Å²',
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
            "eco_term": "computational evidence",
            "eco_code": "ECO_0007672"
        }],
    };
}}));

module.exports = router;