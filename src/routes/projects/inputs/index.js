const Router = require('express').Router;
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { BAD_REQUEST, INTERNAL_SERVER_ERROR } = require('../../../utils/status-codes');
// Get auxiliar functions
const { getRequestUrl } = require('../../../utils/auxiliar-functions');

// Import yaml parsing tool
const yaml = require('yamljs');

// Set the accepted formats and all their accepted names
const supportedFormats = {
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json'
};

// Set the defualt format for the inputs file
const defaultFormat = 'yaml';

// Set a regular expression to match any possible files in the database
const TOPOLOGY_FILENAME_REGEXP = /(^topology.(prmtop|top|psf|tpr)$)/;

const router = Router({ mergeParams: true });

// Root
router.route('/').get(
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
      // Stablish database connection and retrieve our custom handler
      const database = await getDatabase(request);
      // Get the requested project data
      const projectData = await database.getRawProjectData();
      // If something went wrong while requesting project data then stop here
      if (projectData.error) return projectData;
      // Now set the the inputs object to be sent as response
      // Get metadata
      const metadata = projectData.metadata;
      if (!metadata) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: `Project ${projectData.accession} has no metadata`
      }
      // Prepare the input interactions as only interaction names and selections
      const interactions = metadata.INTERACTIONS;
      if (interactions) {
        for (const interaction of interactions) {
          delete interaction.residues_1;
          delete interaction.residues_2;
          delete interaction.interface_1;
          delete interaction.interface_2;
          delete interaction.type;
        }
      }
      // Set the URL to request files from this API
      // Set the project endpoint by removing the '/inputs' at the end
      const inputsEndpoint = getRequestUrl(request);
      const projectEndpoint = inputsEndpoint.slice(0, inputsEndpoint.length - 7);
      const projectFilesEndpoint = `${projectEndpoint}/files`;
      // Numberate MDs before removing some of them
      projectData.mds.forEach((md, index) => md.num = index + 1);
      // Filter away removed MDs
      projectData.mds = projectData.mds.filter(md => !md.removed);
      // Set the input mds by removing all generated fields on each MD
      // Also include explicit structure and trajectory path for each MD
      projectData.mds.forEach(md => {
        md.directory = md.name ? md.name.replace(' ','_') : 'replica_'+md.num;
        const mdFilesEndpoint = `${projectEndpoint}.${md.num}/files`;
        md.input_structure_filepath = `${mdFilesEndpoint}/structure.pdb`;
        md.input_trajectory_filepaths = `${mdFilesEndpoint}/trajectory.xtc`;
        delete md.num;
        delete md.atoms;
        delete md.frames;
        delete md.refframe;
        delete md.analyses;
        delete md.files;
        delete md.warnings;
      })
      // Set the input topology file
      const topologyFile = projectData.files.find(file => TOPOLOGY_FILENAME_REGEXP.exec(file.name));
      const topologyFilename = (topologyFile && topologyFile.name) || 'topology.json';
      const topologyFilepath = `${projectFilesEndpoint}/${topologyFilename}`;
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
        accession: projectData.accession,
        links: metadata.LINKS,
        pdb_ids: metadata.PDBIDS,
        framestep: metadata.FRAMESTEP,
        temp: metadata.TEMP,
        ensemble: metadata.ENSEMBLE,
        timestep: metadata.TIMESTEP,
        ff: metadata.FF,
        wat: metadata.WAT,
        boxtype: metadata.BOXTYPE,
        interactions: interactions,
        pbc_selection: metadata.PBC_SELECTION,
        cg_selection: metadata.CG_SELECTION,
        forced_references: metadata.FORCED_REFERENCES,
        multimeric: metadata.MULTIMERIC,
        chainnames: metadata.CHAINNAMES,
        ligands: metadata.INPUT_LIGANDS,
        membranes: metadata.MEMBRANES,
        customs: metadata.CUSTOMS,
        orientation: metadata.ORIENTATION,
        collections: metadata.COLLECTIONS,
        mds: projectData.mds,
        mdref: projectData.mdref,
        input_topology_filepath: topologyFilepath
      };
      // Add collection specific fields
      if (metadata.COLLECTIONS == 'cv19') {
        inputs.cv19_unit = metadata.CV19_UNIT;
        inputs.cv19_startconf = metadata.CV19_STARTCONF;
        inputs.cv19_abs = metadata.CV19_ABS;
        inputs.cv19_nanobs = metadata.CV19_NANOBS;
      }
      // Return the inputs object to be sent as response and the output format
      return { inputs, format }
    },
    headers(response, retrieved) {
      // There should always be a retrieved object
      if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
      // If there is any specific header error in the retrieved then send it
      // Note that we do not end the response here since the body may contain useful error logs
      if (retrieved.headerError) response.status(retrieved.headerError);
      // Set response header for length and type
      response.set('content-length', retrieved.length * 4);
      // NEVER FORGET: This header prevents accents to being converted to weird characters
      // This error is visible in web browsers, but not when written
      response.set('content-type', 'text/plain');
    },
    // If there is retrieved and the retrieved has metadata then send the inputs file
    body(response, retrieved) {
      // If nothing is retrieved then end the response
      // Note that the header 'sendStatus' function should end the response already, but just in case
      if (!retrieved) return response.end();
      // If there is any error in the body then just send the error
      if (retrieved.error) return response.json(retrieved.error);
      // WARNING: Note that parsing to json makes disappear all fields set as 'undefined'
      if (retrieved.format === 'json') response.json(retrieved.inputs);
      // WARNING: Note that the YAML file has no comments as when it is generated from the workflow
      // The second argument in the stringify is the nexting limit to switch to one-line notation
      // However, nowadays, there should be nothing nested deeper than 3
      else if (retrieved.format === 'yaml') {
        const stringResponse = yaml.stringify(retrieved.inputs, 4);
        response.end(stringResponse);
      }
      else throw new Error(`Format not supported ${retrieved.format}`);
    },
  }),
);

module.exports = router;