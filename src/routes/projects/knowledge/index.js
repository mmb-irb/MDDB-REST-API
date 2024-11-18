const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Load auxiliar functions
const { intersection } = require('../../../utils/auxiliar-functions');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { NOT_FOUND } = require('../../../utils/status-codes');

const router = Router({ mergeParams: true });

// List the supported analyses with knowledge endpoint
const SUPPORTED_ANALYSES = new Set(['sasa']);

// Root
router.route('/').get(
  handler({
    async retriever(request) {
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const project = await database.getProject();
      // If there was any problem then return the errors
      if (project.error) return project;
      // Get the available analyses
      const availableAnalyses = new Set(project.data.analyses);
      // Keep only available and supported analyses
      const availableKnowledge = intersection(SUPPORTED_ANALYSES, availableAnalyses)
      return Array.from(availableKnowledge);
    }
  }),
);

// Functions below return analysis data according to tge FunPDBe schema
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_schema.json
// https://github.com/PDBe-KB/funpdbe-schema/blob/master/funpdbe_example.json

// When a specific analysis is requested (e.g. .../knowledge/rmsds)
router.route('/sasa').get(
  handler({
    async retriever(request) {
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
      // Filter PDB references
      const pdbReferences = referenceData.filter(reference => reference.ref_type === 'pdbs');
      // Make sure we have PDB references
      if (pdbReferences.length === 0) return {
        headerError: NOT_FOUND,
        error: `No PDB references found for project ${project.accession}`
      }
      // Now transform the analysis data into PDBe friendly knowledge
      const pdbKnowledge = [];
      // Set the sites list to add further data
      let site_count = 1;
      const sites = [];
      // To do so we must anotate data in reference to PDB ids, PDB chains and residues
      // Iterate over the different PDB references
      for (const pdbReference of pdbReferences) {
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
            // Add SASA data as a site
            const site = {
              site_id: site_count,
              label: `${chainLetter} - ${residueName} ${residueNumber} SAS`,
              additional_site_annotations: {
                mean: analysisData.means[residueIndex],
                stdv: analysisData.stdvs[residueIndex]
              }
            };
            sites.push(site);
            // Add current PDB residue to the list
            pdbResidues.push({
              pdb_res_label: residueNumber.toString(),
              aa_type: residueName,
              site_data: {
                site_id_ref: site_count,
                confidence_classification: "medium",
              },
            });
            // Add one to the site counter
            site_count += 1;
          })
          // Add the current PDB chain to the list
          pdbChains.push({
            chain_label: chainLetter,
            residues: pdbResidues
          })
        }
        // Push the current PDB knowledge to the list
        pdbKnowledge.push({
          data_resource: "mddb_sasa",
          pdb_id: pdbReference.id,
          chains: pdbChains,
          evidence_code_ontology: null,
          sites: sites,
        });
      }
      // Return the final response in the expected format
      return pdbKnowledge;
    }
  }),
);

module.exports = router;