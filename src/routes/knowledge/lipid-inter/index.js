const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND, INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
const { PROTEIN_RESIDUE_NAME_LETTERS } = require('../../../utils/constants');
const { getHost } = require('../../../utils/auxiliar-functions');
const { buildKnowledgeResponse, formatKnowledgeDate } = require('../shared');

// Set the name of the current analysis
const ANALYSIS_NAME = 'lipid-inter';

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
    // Make sure the analysis is present in the project
    if (!project.data.analyses.includes(ANALYSIS_NAME)) return {
        headerError: NOT_FOUND,
        error: `Project ${project.accession} has not "${ANALYSIS_NAME}" data.`
    }
    // Query the database and retrieve the requested analysis
    const analysisData = await project.getAnalysisData(ANALYSIS_NAME);
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
    // Make sure the requested PDB id is among the PDB references in this project
    if (!project.data.metadata.PDBIDS.includes(pdbId)) return {
        headerError: NOT_FOUND,
        error: `Project ${project.accession} has not reference PDB "${pdbId}".`
    }
    // Filter PDB references
    const pdbReference = referenceData.find(reference => reference.ref_type === 'pdbs' && reference.id === pdbId);
    // Make sure we have PDB references
    if (!pdbReference) return {
        headerError: NOT_FOUND,
        error: `PDB reference ${pdbId} not found for project ${project.accession}`
    }
    
    // Extract the lipid interaction data from the analysis data structure
    const lipidData = analysisData.data || analysisData;
    let poreFacingFractions = [];
    if (project.data.analyses.includes('channels')) {
        const channelsData = await project.getAnalysisData('channels');
        if (!channelsData.error) {
            poreFacingFractions = channelsData.data?.pore_residues?.pore_facing || [];
        }
    }
    
    
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
    // Iterate over the different UniProt ids
    // Note that we may have more tha one chain in the PDB belonging to the same UniProt
    // Note that we may have more tha one chain in the simulation to the same UniProt
    // There are many possible scenarios and there is no simple rule to match chains always
    // For this reason, for every different UniProt id, we will use only the first chain
    // We will path values from the first system chain with numeration of the first PDB chain
    const uniprotIds = new Set(Object.values(pdbReference.chain_uniprots));
    for (const uniprotId of uniprotIds) {
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
        // Iterate residue indices
        for (const residueIndex of residueIndices) {
            // Get the residue numeration according to the reference (uniprot)
            const residueUniprotNumber = topologyData.residue_reference_numbers[residueIndex];
            // Now use the uniprot 2 pdb map to get the equivalent PDB values
            const uniprotKey = `${uniprotId}_${residueUniprotNumber}`;
            const pdbEquivalent = pdbReference.uni2pdb[uniprotKey];
            if (!pdbEquivalent) continue;
            // If there is no PDB equivalent then this residue is not present in the PDB
            // We will return no data for this specific residue
            const [chainLetter, residueLabel, residueType] = pdbEquivalent;
            // Get the amino acid single letter code
            const residueLetter = PROTEIN_RESIDUE_NAME_LETTERS[residueType] || 'X';
            
            // Get max contact probability for tail and head across all lipid types
            const tailInteraction = tailByResidue[residueIndex] || 0;
            const headInteraction = headByResidue[residueIndex] || 0;
            const solventInteraction = 0; // Not yet available in analysis output
            const poreFacingFraction = poreFacingFractions[residueIndex] || 0;
            const poreFacing = poreFacingFraction > 0.5;
            
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
            
            // Get the list of residues which belong to the current chain
            let pdbResidues = pdbChains[chainLetter];
            if (pdbResidues === undefined)
                pdbChains[chainLetter] = pdbResidues = [];
            // Add current PDB residue to the list
            pdbResidues.push({
                pdb_res_label: residueLabel,
                aa_type: residueType,
                additional_residue_annotations: {
                    mddb_lipid_data: {
                        'group=Tail': tailInteraction,
                        'group=Head': headInteraction,
                        'group=Solvent': solventInteraction,
                        pore_inner_surface: poreFacing,
                    }
                },
                site_data: site_data
            });
        }
    }
    // Convert the pdbChains object to an array
    const finalPdbChains = Object.entries(pdbChains).map(([chainLabel, residues]) => ({
        chain_label: chainLabel,
        residues: residues
    }));
    // If no PDB chains were found then something is wrong
    if (finalPdbChains.length === 0) return {
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
    const url = `${protocol}://${host}/#/id/${request.params.project}/`;
    // Set the date in the expected format
    const funschemaDate = formatKnowledgeDate(pdbReference.date);
    // Return the final response in the expected format
    return buildKnowledgeResponse({
        resourceVersion: '0.0',
        resourceEntryUrl: url,
        modelCoordinatesUrl: `https://www.ebi.ac.uk/pdbe/entry/pdb/${pdbReference.id}`,
        releaseDate: funschemaDate,
        pdbId: pdbReference.id,
        sourceId: request.params.project,
        chains: finalPdbChains,
        // Set the sites list according to MemProtMD schema
        sites: [
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
        ],
    });
}}));

module.exports = router;