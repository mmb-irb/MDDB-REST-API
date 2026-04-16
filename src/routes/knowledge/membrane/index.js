const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
const { getHost } = require('../../../utils/auxiliar-functions');

// Instantiate the router
const router = Router({ mergeParams: true });

// Functions below return analysis data according to the FunPDBe schema
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_schema.json
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_example.json

// PDBe knowledge Lipid Interactions endpoint
router.route('/').get( handler({ async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Get the requested project data
    const project = await database.getProject();
    // If there was any problem then return the errors
    if (project.error) return project;
    // Query the database and retrieve the requested analysis
    const analysisData = await project.getAnalysisData('lipid-inter');
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
    
    // Extract the lipid interaction data from the analysis data structure
    const lipidData = analysisData.data || analysisData;
    // Set the sites list according to MemProtMD schema
    const sites = [
        {
            site_id: 1,
            label: "membrane lipid acyl-tail interacting residue",
        },
        {
            site_id: 2,
            label: "membrane lipid head-group interacting residue",
        },
        {
            site_id: 3,
            label: "solvent interacting residue",
        },
        {
            site_id: 4,
            label: "pore-facing residue",
        },
    ];
    
    // Helper function to classify confidence based on interaction fraction
    const classifyConfidence = (value) => {
        if (value >= 0.5) return 'high';
        if (value >= 0.2) return 'medium';
        return 'low';
    };

    // Detect whether a lipid entry uses the new {head, tail} format or the old flat array
    // Old format can be removed once all analyses are re-run with version >= 0.1.0
    const isNewFormat = (lipidEntry) => !Array.isArray(lipidEntry);

    // Pre-build per-residue interaction maps aggregated across all lipid types.
    // Values are the max contact probability across all lipid species (0-1).
    const lipidKeys = Object.keys(lipidData).filter(key => key !== 'residue_indices');
    if (lipidKeys.length === 0) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: 'No lipid interaction data found in analysis'
    };
    // Maps from residueIndex -> max probability for tail and head contacts
    const tailByResidue = {};
    const headByResidue = {};
    for (const key of lipidKeys) {
        const entry = lipidData[key];
        lipidData.residue_indices.forEach((residueIndex, pos) => {
            if (isNewFormat(entry)) {
                // New format: {head: [...], tail: [...]}
                tailByResidue[residueIndex] = Math.max(tailByResidue[residueIndex] || 0, entry.tail[pos] || 0);
                headByResidue[residueIndex] = Math.max(headByResidue[residueIndex] || 0, entry.head[pos] || 0);
            } else {
                // Old flat format: treat entire value as tail interaction
                tailByResidue[residueIndex] = Math.max(tailByResidue[residueIndex] || 0, entry[pos] || 0);
            }
        });
    }

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
            if (residueReferenceIndex === referenceIndex) residueIndices.push(parseInt(residueIndex));
        });
        // Get residue data according to the FunPDBe schema
        const pdbResidues = [];
        
        // Iterate residue indices
        residueIndices.forEach(residueIndex => {
            // Get the residue numeration according to the reference (uniprot and thus the PDB)
            const residueNumber = topologyData.residue_reference_numbers[residueIndex];
            // Get residue name
            const residueName = topologyData.residue_names[residueIndex];

            // Get max contact probability for tail and head across all lipid types
            const tailInteraction = tailByResidue[residueIndex] || 0;
            const headInteraction = headByResidue[residueIndex] || 0;
            const solventInteraction = 0; // Not yet available in analysis output
            const poreFacing = false;     // Not yet available in analysis output
            
            // Build site_data array with confidence for each site
            const site_data = [
                {
                    site_id_ref: 1,
                    confidence_classification: classifyConfidence(tailInteraction)
                },
                {
                    site_id_ref: 2,
                    confidence_classification: classifyConfidence(headInteraction)
                },
                {
                    site_id_ref: 3,
                    confidence_classification: classifyConfidence(solventInteraction)
                },
                {
                    site_id_ref: 4,
                    confidence_classification: poreFacing ? 'high' : 'low'
                }
            ];
            
            // Add current PDB residue to the list
            pdbResidues.push({
                pdb_res_label: residueNumber.toString(),
                aa_type: residueName,
                additional_residue_annotations: {
                    MDDB_lipid_data: {
                        'group=Tail': tailInteraction,
                        'group=Head': headInteraction,
                        'group=Solvent': solventInteraction,
                        pore_inner_surface: poreFacing
                    }
                },
                site_data: site_data
            });
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
    // Get the requesting protocol, host and URL base
    // It will be used to generate the URLs
    const protocol = request.protocol;
    const host = getHost(request);
    // Add the cliente equivalent project URL as it has been suggested
    // HARDCODE: El host de la query no tiene por que ser el del cliente
    // HARDCODE: De hecho una API podría no tener cliente asociado o tener varios
    const url = `${protocol}://${host}/#/id/${project.accession}/`;
    // Return the final response in the expected format
    return {
        data_resource: "MDDB",
        resource_version: "0.0",
        resource_entry_url: url,
        model_coordinates_url: `https://www.ebi.ac.uk/pdbe/entry/pdb/${pdbReference.id}`,
        release_date: pdbReference.date,
        pdb_id: pdbReference.id,
        chains: pdbChains,
        evidence_code_ontology: [{
            "eco_term": "molecular dynamics evidence used in automatic assertion",
            "eco_code": "ECO_0006373"
        }],
        sites: sites,
    };
}}));

module.exports = router;