const Router = require('express').Router;

const handler = require('../../../utils/generic-handler');

const { NOT_FOUND, BAD_REQUEST } = require('../../../utils/status-codes');
// Get an automatic mongo query parser based on environment and request
const { getProjectQuery } = require('../../../utils/get-project-query');

// Import yaml parsing tool
const yaml = require('yamljs');

const analysisRouter = Router({ mergeParams: true });

// Set the accepted formats and all their accepted names
const supportedFormats = {
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json'
};

// Set the defualt format for the inputs file
const defaultFormat = 'yaml';

// This endpoint builds the MoDEL workflow's 'inputs.json' file
module.exports = (_, { projects }) => {
  // Root
  analysisRouter.route('/').get(
    handler({
      async retriever(request) {
        // Set the format to export inputs
        let format = defaultFormat;
        // Get the requested format
        const queryFormat = request.query.format;
        if (queryFormat) {
          const requestedFormat = supportedFormats[queryFormat];
          // If requested format is not defined then return an error
          if (!requestedFormat) {
            const availableFormats = [...new Set(Object.values(supportedFormats))].join(', ');
            return {
              headerError: BAD_REQUEST,
              error: `Query format "${queryFormat}" is not supported. Please ask for one of these: ${availableFormats}`
            };
          }
          format = requestedFormat;
        }
        // Get the requested project data
        const projectData = await projects.findOne(
          getProjectQuery(request),
          // But return only the "metadata" attribute
          { projection: { _id: false, metadata: true, mds: true, mdref: true } },
        );
        // Return the project which matches the request accession
        return { projectData, format }
      },
      // If there is nothing retrieved send a NOT_FOUND status in the header
      headers(response, retrieved) {
        if (!retrieved) response.sendStatus(NOT_FOUND);
        // In case of error
        if (retrieved.headerError) return response.status(retrieved.headerError);
      },
      // If there is retrieved and the retrieved has metadata then send the inputs file
      body(response, retrieved) {
        if (!retrieved) return response.end();
        // In case of error
        if (retrieved.error) return response.json(retrieved.error);
        const projectData = retrieved.projectData;
        const metadata = projectData.metadata;
        if (!metadata) return response.json({ error: 'There is no metadata' });
        // Prepare the input interactions as only interaction names and selections
        const interactions = metadata.INTERACTIONS;
        if (interactions) {
          for (const interaction of interactions) {
            delete interaction.residues_1;
            delete interaction.residues_2;
            delete interaction.interface_1;
            delete interaction.interface_2;
          }
        }
        // Set the input mds by removing all generated fields on each MD
        projectData.mds.forEach(md => {
          delete md.atoms;
          delete md.frames;
          delete md.analyses;
          delete md.files;
          delete md.warnings;
        })
        // Prepare the inputs json file to be sent
        const inputs = {
          name: metadata.NAME,
          description: metadata.DESCRIPTION,
          authors: metadata.AUTHORS,
          groups: metadata.GROUPS,
          contact: metadata.CONTACT,
          program: metadata.PROGRAM,
          version: metadata.VERSION,
          type: metadata.TYPE,
          method: metadata.METHOD,
          license: metadata.LICENSE,
          linkcense: metadata.LINKCENSE,
          citation: metadata.CITATION,
          thanks: metadata.THANKS,
          links: metadata.LINKS,
          pdbIds: metadata.PDBIDS,
          framestep: metadata.FRAMESTEP,
          temp: metadata.TEMP,
          ensemble: metadata.ENSEMBLE,
          timestep: metadata.TIMESTEP,
          ff: metadata.FF,
          wat: metadata.WAT,
          boxtype: metadata.BOXTYPE,
          interactions: interactions,
          pbc_selection: metadata.PBC_SELECTION,
          forced_references: metadata.FORCED_REFERENCES,
          multimeric: metadata.MULTIMERIC,
          chainnames: metadata.CHAINNAMES,
          ligands: metadata.LIGANDS,
          membranes: metadata.MEMBRANES,
          customs: metadata.CUSTOMS,
          orientation: metadata.ORIENTATION,
          collections: metadata.COLLECTIONS,
          mds: projectData.mds,
          mdref: projectData.mdref,
          // Input file paths are written to the json file for coherence
          // However they are left as none since the workflow will use defaults
          input_structure_filepath: null,
          input_trajectory_filepaths: null,
          input_topology_filepath: null
        };
        // Add collection specific fields
        if (metadata.COLLECTIONS == 'cv19') {
          inputs.cv19_unit = metadata.CV19_UNIT;
          inputs.cv19_startconf = metadata.CV19_STARTCONF;
          inputs.cv19_abs = metadata.CV19_ABS;
          inputs.cv19_nanobs = metadata.CV19_NANOBS;
        }
        // WARNING: Note that parsing to json makes disappear all fields set as 'undefined'
        if (retrieved.format === 'json') response.json(inputs);
        // WARNING: Note that the YAML file has no comments as when it is generated from the workflow
        else if (retrieved.format === 'yaml') response.end(yaml.stringify(inputs));
        else throw new Error(`Format not supported ${retrieved.format}`);
      },
    }),
  );

  return analysisRouter;
};
