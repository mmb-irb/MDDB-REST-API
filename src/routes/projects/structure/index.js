const Router = require('express').Router;
const { Readable } = require('stream');
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR, BAD_REQUEST } = require('../../../utils/status-codes');
// Get a function to issue a standard output filename
const { setOutputFilename, rangedSelectionParser } = require('../../../utils/auxiliar-functions');
// Functions to handle the residue numeration
const { NUMBERINGS, parseNumbering, applyNumbering } = require('../../../utils/topology-tools');
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
// Function to produce a PDB from topology and coordinates
const producePdb = require('./produce-pdb');
// Function to produce a mmCIF from topology and coordinates
const produceMmcif = require('./produce-mmcif');

// Supported output formats
// Note that format names are case insensitive
const structureFormats = {
  pdb: { extension: 'pdb', contentType: 'chemical/x-pdb', producer: producePdb },
  mmcif: { extension: 'cif', contentType: 'chemical/x-mmcif', producer: produceMmcif },
};
structureFormats.cif = structureFormats.mmcif;

const router = Router({ mergeParams: true });

// When structure is requested (i.e. .../structure)
// Note that structure may be requested both through GET and POST methods
// POST method was implemented to allow long atom selections
const structureHandler = handler({
  supportedArguments: ['format', 'numbering', 'selection', 'atomindices', 'resindices', 'chaindices'],
  async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Find the requested project data
    const project = await database.getProject();
    // If there was any problem then return the errors
    if (project.error) return project;
    // Get the requested output format, which is PDB by default
    const requestedFormat = request.body.format || request.query.format || 'pdb';
    const structureFormat = structureFormats[String(requestedFormat).toLowerCase()];
    if (!structureFormat) return {
      headerError: BAD_REQUEST,
      error: `Not supported format "${requestedFormat}". Supported formats are PDB and mmCIF (or CIF)`
    };
    // Get the requested residue numeration, which is the author numeration by default
    // It is used by the NGL selection and in the residue numbers of the PDB
    // Note that the mmCIF has always both numerations
    const requestedNumbering = request.body.numbering || request.query.numbering;
    const numbering = parseNumbering(requestedNumbering);
    if (!numbering) return {
      headerError: BAD_REQUEST,
      error: `Not supported numbering "${requestedNumbering}". Supported numberings are ${NUMBERINGS.join(', ')}`
    };
    // Download the main structure file descriptor
    const structureDescriptor = await project.getFileDescriptor(database.STANDARD_STRUCTURE_FILENAME);
    // If the object ID is not found in the data base the we have a mess
    // This is our fault, since a file id coming from a project must exist
    if (structureDescriptor.error) return structureDescriptor;
    // Get the NGL atom selection, if any
    const selection = request.body.selection || request.query.selection;
    // Get the topology data, only the fields needed to build the structure
    // Note that NGL selections are always parsed from a mmCIF, no matter the requested format
    // Note that the mmCIF fields include the reference numbers, which are needed by the UniProt numeration
    // Note that the selections below use some of these fields as well
    const needsMmcifFields = selection || numbering !== 'author';
    const topologyFields = needsMmcifFields ? produceMmcif.TOPOLOGY_FIELDS : structureFormat.producer.TOPOLOGY_FIELDS;
    const topologyData = await project.getTopologyData(topologyFields);
    // Set the topology with the requested numeration, used by the NGL selection and the PDB
    const numberedTopologyData = applyNumbering(topologyData, numbering);
    // Get any kind of requested selection
    // If multiple values are passed then the sum of them will be returned
    // We check both the body (in case it is a POST) and the query (in case it is a GET)
    // Ranged selections (e.g. 0-9,12) must not exceed the number of atoms, residues and chains
    // The user may request directly a list of atom indices
    let atomIndices = request.body.atomindices || request.query.atomindices || [];
    if (typeof atomIndices === 'string')
      atomIndices = rangedSelectionParser(atomIndices, topologyData.atom_residue_indices.length, 'atom');
    if (atomIndices.error) return atomIndices;
    // The user may request directly a list of residue indices
    let residueIndices = request.body.resindices || request.query.resindices || [];
    if (typeof residueIndices === 'string')
      residueIndices = rangedSelectionParser(residueIndices, topologyData.residue_chain_indices.length, 'residue');
    if (residueIndices.error) return residueIndices;
    // The user may request directly a list of residue indices
    let chainIndices = request.body.chaindices || request.query.chaindices || [];
    if (typeof chainIndices === 'string')
      chainIndices = rangedSelectionParser(chainIndices, topologyData.chain_names.length, 'chain');
    if (chainIndices.error) return chainIndices;
    // Make sure all indices are positive integers
    const wrongIndices = [...atomIndices, ...residueIndices, ...chainIndices].map(Number)
      .filter(index => !Number.isInteger(index) || index < 0);
    if (wrongIndices.length > 0) return {
      headerError: BAD_REQUEST,
      error: 'Atom, residue and chain indices must be positive integers (0-based) or ranges of them (e.g. 0-9,12)'
    };
    // Check if there was any atom selection argument
    const anySelection = Boolean(atomIndices.length || residueIndices.length || chainIndices.length || selection);
    // In case of an NGL selection we will parse the selection to a list of atom indices using NGL itself
    if (selection) {
      // Get reference frame coordinates
      const frameCoordinates = await project.getFrameCoordinates(project.referenceFrame);
      if (frameCoordinates.error) return frameCoordinates;
      // Produce a mmCIF file using both the topology data and reference frame coordinates
      // Note that mmCIF has no limits in atom numbers, residue numbers or chain names, unlike PDB
      // Note that NGL reads the residue numbers from the author fields, where the requested numeration is written
      const mmcifContent = produceMmcif(numberedTopologyData, frameCoordinates);
      if (mmcifContent.error) return mmcifContent;
      // Convert the mmCIF content to a buffer
      const bufferMmcif = Buffer.from(mmcifContent, 'utf-8');
      // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
      const nglAtomIndices = await getAtomIndices(bufferMmcif, selection);
      atomIndices.push(...nglAtomIndices);
    }
    // In case chain indices are passed we must convert them to residue indices
    if (chainIndices) {
      chainIndices = new Set(chainIndices);
      topologyData.residue_chain_indices.forEach((chainIndex, residueIndex) => {
        if (chainIndices.has(chainIndex)) residueIndices.push(residueIndex);
      });
    }
    // In case residue indices are passed we must convert them to atom indices
    if (residueIndices) {
      residueIndices = new Set(residueIndices);
      topologyData.atom_residue_indices.forEach((residueIndex, atomIndex) => {
        if (residueIndices.has(residueIndex)) atomIndices.push(atomIndex);
      });
    }
    // In case any selection argument was passed, make sure it matched something
    if (anySelection) {
      // If there are no atoms indices after a sellection then return an error
      if (atomIndices.length === 0) return {
        headerError: BAD_REQUEST,
        error: 'Your custom selection is matching no atoms'
      }
      // Make sure atom indices are unique
      atomIndices = [...new Set(atomIndices)];
    }
    // If no selection was made then set the atom indices as undefined
    // Thus further functions will interpret that there is no selection and all atoms are to be returned
    else atomIndices = undefined;
    // Get reference frame coordinates
    const frameCoordinates = await project.getFrameCoordinates(project.referenceFrame, atomIndices);
    if (frameCoordinates.error) return frameCoordinates;
    // Produce a filtered structure file in the requested format
    // Use both the topology data and reference frame coordinates
    const dataName = project.data.accession || project.data.internalId.toString();
    // The mmCIF has always both numerations, while the PDB has only the requested one
    const outputTopologyData = structureFormat.producer === produceMmcif ? topologyData : numberedTopologyData;
    const structureContent = structureFormat.producer(outputTopologyData, frameCoordinates, atomIndices, dataName);
    if (structureContent.error) return structureContent;
    // Convert the structure content to a buffer adn then to a stream
    const bufferStructure = Buffer.from(structureContent, 'utf-8');
    const stream = Readable.from([bufferStructure]);
    // Modify the original descriptor length and content type
    structureDescriptor.length = bufferStructure.length;
    structureDescriptor.contentType = structureFormat.contentType;
    // Set the output filename according to some standards
    const filename = setOutputFilename(project.data, structureDescriptor, structureFormat.extension);
    return { filename, structureDescriptor, stream };
  },
  // Handle the response header
  headers(response, retrieved) {
    // There should always be a retrieved object
    if (!retrieved) return response.sendStatus(INTERNAL_SERVER_ERROR);
    // If there is any specific header error in the retrieved then send it
    // Note that we do not end the response here since the body may contain additional error details
    if (retrieved.headerError) return response.status(retrieved.headerError);
    // If there is an active stream, send range and length content
    response.set('content-length', retrieved.structureDescriptor.length);
    // Send content type also if known
    if (retrieved.structureDescriptor.contentType) {
      response.set('content-type', retrieved.structureDescriptor.contentType);
    }
    // Set the output filename
    response.setHeader(
      'Content-disposition',
      `attachment; filename=${retrieved.filename}`,
    );
  },
  // Handle the response body
  body(response, retrieved, request) {
    // If nothing is retrieved then end the response
    // Note that the header 'sendStatus' function should end the response already, but just in case
    if (!retrieved) return response.end();
    // If there is any error in the body then just send the error
    if (retrieved.error) return response.json(retrieved.error);
    // If there is not retreieved stream, return here
    if (!retrieved.stream) return response.end();
    // If the client has aborted the request before the streams starts, destroy the stream
    if (request.aborted) {
      retrieved.stream.destroy();
      return;
    }
    // If there is a retrieved stream, start sending data through the stream
    // Resume when the response drains instead of using write callbacks
    // The compression middleware does not call write callbacks, which would stall the stream
    // A single listener is used since 'once' listeners are not removed while compressing
    response.on('drain', () => retrieved.stream.resume());
    retrieved.stream.on('data', data => {
      // Pause until the response drains (see the 'drain' listener above)
      if (!response.write(data)) retrieved.stream.pause();
    });
    // If there is an error, send the error to the console and end the data transfer
    retrieved.stream.on('error', error => {
      console.error(error);
      response.end();
    });
    // Close the response when the read stream has finished
    retrieved.stream.on('end', data => response.end(data));
    // Close the stream when the request is closed
    request.on('close', () => retrieved.stream.destroy());
  },
});

// Support both the http GET and POST methods
router.route('/').get(structureHandler);
router.route('/').post(structureHandler);

module.exports = router;