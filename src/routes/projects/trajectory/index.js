const Router = require('express').Router;
const { Readable, PassThrough } = require('stream');
// A standard request and response handler used widely in most endpoints
const handler = require('../../../utils/generic-handler');
// Get the database handler
const getDatabase = require('../../../database');
// Converts the stored file (.bin) into human friendly format (chemical/mdcrd)
const BinToMdcrdStream = require('../../../utils/bin-to-mdcrd');
// Get tools to handle range queries
const handleRanges = require('../../../utils/handle-ranges');
const { rangeIndices } = require('../../../utils/parse-query-range');
// Returns a simple stream when asking for the whole file
// Returns an internally managed stream when asking for specific ranges
const getRangedStream = require('../../../utils/get-ranged-stream');
// Returns the selected atom indices as a string ("i1-i1,i2-i2,i3-i3..."")
const getAtomIndices = require('../../../utils/get-atom-indices-through-ngl');
// Translates the frames query string format into a explicit frame selection in string format
const chemfilesConverter = require('../../../utils/bin-to-chemfiles');

// Get a function to issue a standard output filename
const { setOutputFilename, getConfig, rangedSelectionParser } = require('../../../utils/auxiliar-functions');
// Function to produce a mmCIF from topology and coordinates (used when resolving NGL selections)
const produceMmcif = require('../structure/produce-mmcif');
// Functions to handle the residue numeration
const { NUMBERINGS, parseNumbering, applyNumbering } = require('../../../utils/topology-tools');
// Get the API version requested by the user
const { getApiVersion } = require('../../../utils/api-version');

// Standard HTTP response status codes
const {
  BAD_REQUEST,
  INTERNAL_SERVER_ERROR,
} = require('../../../utils/status-codes');

// Trajectory exporting supported formats
const trajectoryFormats = {
  bin: {
    name: 'bin',
    contentType: 'application/octet-stream',
  },
  mdcrd: {
    name: 'mdcrd',
    contentType: 'text/mdcrd',
  },
  xtc: {
    name: 'xtc',
    contentType: 'application/xtc',
    chemfilesName: 'XTC',
    // The whole box matrix is stored, so a rotated box (e.g. after a fit) is kept as is
    includesBox: true,
  },
  trr: {
    name: 'trr',
    contentType: 'application/trr',
    chemfilesName: 'TRR',
    includesBox: true,
  },
  // Streaming NetCDF requires the chemfiles fork to know the number of frames in advance
  // The chemfiles converter sets it from the frame count passed as argument
  nc: {
    name: 'nc',
    contentType: 'application/nc',
    chemfilesName: 'Amber NetCDF',
  },
  // DCD also stores the number of frames in the header, so it is streamed the same way
  dcd: {
    name: 'dcd',
    contentType: 'application/dcd',
    chemfilesName: 'DCD',
  },
};

// Range arguments of the trajectory and the box, which are handled by 'handleRanges'
// Every dimension may be selected by its letter or by its name, as set in the file descriptor
// Note that 'atoms' is the legacy name for the atom selection (1-based ranges)
const TRAJECTORY_RANGE_ARGUMENTS = ['bytes', 'x', 'coords', 'y', 'atoms', 'z', 'frames'];
const BOX_RANGE_ARGUMENTS = ['bytes', 'x', 'coords', 'y', 'vectors', 'z', 'frames'];
// Supported arguments in every endpoint
const COORDINATES_ARGUMENTS = [
  ...TRAJECTORY_RANGE_ARGUMENTS, 'selection', 'numbering', 'atomindices', 'resindices', 'chaindices'
];
const TRAJECTORY_ARGUMENTS = ['format', ...COORDINATES_ARGUMENTS];
const BOX_ARGUMENTS = BOX_RANGE_ARGUMENTS;

// Check if the requested files meet the accepted formats, which are provided by the request header
// If so, send the format name. Else, send null
const acceptTransformFormat = requestedFormat => {
  // If no format is specified then the source format is returned in v1 and xtc since v2
  if (!requestedFormat) return getApiVersion() >= 2 ? trajectoryFormats.xtc : trajectoryFormats.bin;
  const _requestedFormat = requestedFormat.toLowerCase();
  // _requested is a string sent by the header which includes the names of all accepted formats
  if (_requestedFormat === 'bin') {
    return trajectoryFormats.bin;
  }
  if (_requestedFormat === 'crd' || _requestedFormat === 'mdcrd') {
    return trajectoryFormats.mdcrd;
  }
  if (_requestedFormat === 'xtc') {
    return trajectoryFormats.xtc;
  }
  if (_requestedFormat === 'trr') {
    return trajectoryFormats.trr;
  }
  if (_requestedFormat === 'nc') {
    return trajectoryFormats.nc;
  }
  if (_requestedFormat === 'dcd') {
    return trajectoryFormats.dcd;
  }
  // If format is not recognized the an error will be sent
  return null;
};

const router = Router({ mergeParams: true });

// Handle the response header of streamed binary files
// This is used by both the trajectory and the box endpoints
const streamHeaders = (
  response,
  {
    stream,
    filename,
    trajectoryDescriptor,
    range,
    transformFormat,
    acceptRanges,
    headerError,
  },
) => {
  // In case of error
  if (headerError) return response.status(headerError);
  // Something went wrong here
  if (!stream) return response.sendStatus(INTERNAL_SERVER_ERROR);
  
  // NEVER FORGET: 'content-range' were disabled and now this data is got from project files
  // NEVER FORGET: This is because, sometimes, the header was bigger than the 8 Mb limit
  //response.set('content-range', range.responseHeaders);

  // NEVER FORGET: This partial content (i.e. 206) makes Chrome fail when downloading data directly from API
  //response.status(PARTIAL_CONTENT);

  // Send the expected bytes length of the file
  // WARNING: If sent bytes are less than specified the download will fail with error signal
  // WARNING: If sent bytes are more than specified the download will succed but it will be cutted
  // WARNING: If sent bytes are a decimal number or null then it will generate an error 502 (Bad Gateway)
  // If we dont send this header the download works anyway, but the user does not know how long it is going to take
  if (range.byteSize) {
    if (range.byteSize % 1 !== 0) console.error('ERROR: Size is not integer');
    response.set('content-length', range.byteSize);
  }
  if (trajectoryDescriptor.contentType) {
    response.set(
      'content-type',
      // Here trajectoryDescriptor.contentType should be "application/octet-stream"
      transformFormat.contentType,
    );
  }
  // Set the output filename
  response.setHeader(
    'Content-disposition',
    `attachment; filename=${filename}`,
  );

  response.set('accept-ranges', acceptRanges);
};

// Handle the response body of streamed binary files
const streamBody = (response, { stream, error }, request) => {
  // In case of error
  if (error) return response.json(error);
  // Something went very wrong here
  if (!stream) return response.end();

  if (request.aborted) {
    stream.destroy();
    return;
  }

  // WARNING: Do not substitute the supervised "response.write" by a "stream.pipe(response)"
  // "pipe" is not able to detect overloading in the response (Unknown reason)
  // Therefore, if response is piped, there may be a memory leak in some situations
  // For example, when client stops receiving data but connection is not closed
  // (e.g. When you pause but do not cancell the download from Chrome)

  // Write the input readable stream with the trajectroy data into the response
  // This is possible since the response is a writable stream itself
  // Resume when the response drains instead of using write callbacks
  // The compression middleware does not call write callbacks, which would stall the stream
  // A single listener is used since 'once' listeners are not removed while compressing
  response.on('drain', () => stream.resume());
  stream.on('data', data => {
    // If you are having this error it means some 'end' event is beeing triggered before all data is consumed
    if (response.finished)
      return console.error('ERROR: Potential data loss');
    // Pause until the response drains (see the 'drain' listener above)
    if (!response.write(data)) stream.pause();
    // use these lines to prevent system collapse in case of memory leak
    /*
    if(process.memoryUsage().rss > 300000000){
      console.error("Memory leak detected");
      stream.destroy();
      console.error("Current stream has been destroyed");
      return;
    }
    */
  });
  // In case of error, print error in console
  stream.on('error', error => {
    console.error(error);
    response.end();
  });
  // Close the response when the read stream has finished
  stream.on('end', data => response.end(data));
  // Close the stream when request is over
  request.on('close', () => stream.destroy());
};

// Get the trajectory in the requested format, with the requested atoms and frames
// This is used by both the trajectory and the coordinates endpoints
const getTrajectory = async (request, transformFormat) => {
  // Stablish database connection and retrieve our custom handler
  const database = await getDatabase(request);
  // Set the bucket, which allows downloading big files from the database
  const bucket = database.bucket;
  // Find the requested project data
  const project = await database.getProject();
  // If there was any problem then return the errors
  if (project.error) return project;
  // Download the main trajectory file descriptor
  const trajectoryDescriptor = await project.getTrajectorFileDescriptor();
  // If the object ID is not found in the data base, return here
  if (trajectoryDescriptor.error) return trajectoryDescriptor;

  // The user may request directly a list of atom indices
  // The legacy name for this field is 'atoms', and this is handled by the 'handleRanges' function
  // Then I added 'atomindices' to make it coherent with the structure endpoint which is handled here
  let atomIndices = request.body.atomindices || request.query.atomindices || [];
  // The user may request directly a list of residue indices
  let residueIndices = request.body.resindices || request.query.resindices || [];
  // The user may request a list of chain indices
  let chainIndices = request.body.chaindices || request.query.chaindices || [];
  // In case we have a selection we must parse it to atoms
  // We check both the body (in case it is a POST) and the query (in case it is a GET)
  const selectionRequest = request.body.selection || request.query.selection;
  // The topology is needed to resolve residue, chain and NGL selections to atoms
  const topologyData = residueIndices.length || chainIndices.length || selectionRequest
    ? await project.getTopologyData()
    : null;
  if (topologyData && topologyData.error) return topologyData;
  // Ranged selections (e.g. 0-9,12) must not exceed the number of atoms, residues and chains
  if (typeof atomIndices === 'string')
    atomIndices = rangedSelectionParser(atomIndices, trajectoryDescriptor.metadata.y.length, 'atom');
  if (atomIndices.error) return atomIndices;
  if (typeof residueIndices === 'string')
    residueIndices = rangedSelectionParser(residueIndices, topologyData.residue_chain_indices.length, 'residue');
  if (residueIndices.error) return residueIndices;
  if (typeof chainIndices === 'string')
    chainIndices = rangedSelectionParser(chainIndices, topologyData.chain_names.length, 'chain');
  if (chainIndices.error) return chainIndices;
  // Indices in lists may come as strings (e.g. ?atomindices=1&atomindices=2) so convert them to numbers
  atomIndices = atomIndices.map(Number);
  residueIndices = residueIndices.map(Number);
  chainIndices = chainIndices.map(Number);
  // Make sure all indices are positive integers which exist in the system
  // Note that ranged selections were already checked, but lists were not
  // Note that the topology is always loaded when there are residue or chain indices
  const isWrong = count => index => !Number.isInteger(index) || index < 0 || index >= count;
  const wrongIndices = [
    ...atomIndices.filter(isWrong(trajectoryDescriptor.metadata.y.length)),
    ...residueIndices.filter(isWrong(topologyData && topologyData.residue_chain_indices.length)),
    ...chainIndices.filter(isWrong(topologyData && topologyData.chain_names.length)),
  ];
  if (wrongIndices.length > 0) return {
    headerError: BAD_REQUEST,
    error: `Wrong indices: ${wrongIndices.slice(0, 10).join(', ')}. Atom, residue and chain indices must be` +
      ' positive integers (0-based) lower than the number of atoms, residues and chains, or ranges of them (e.g. 0-9,12)'
  };
  // Get the residue numeration used by the selection, which is the author numeration by default
  const requestedNumbering = request.body.numbering || request.query.numbering;
  const numbering = parseNumbering(requestedNumbering);
  if (!numbering) return {
    headerError: BAD_REQUEST,
    error: `Not supported numbering "${requestedNumbering}". Supported numberings are ${NUMBERINGS.join(', ')}`
  };
  // The legacy 'atoms' param cannot be combined with the new selection params
  const atomsRequest = request.body.atoms || request.query.atoms;
  const anyNewSelection = atomIndices.length || residueIndices.length || chainIndices.length || selectionRequest;
  if (atomsRequest && anyNewSelection) return {
    headerError: BAD_REQUEST,
    error: 'Cannot use "atoms" together with "atomindices", "resindices", "chaindices", or "selection"'
  };
  // In case chain or residue indices are passed we must resolve them to atom indices
  if (chainIndices.length || residueIndices.length || selectionRequest) {
    // In case chain indices are passed we must convert them to residue indices
    if (chainIndices.length) {
      chainIndices = new Set(chainIndices);
      topologyData.residue_chain_indices.forEach((chainIndex, residueIndex) => {
        if (chainIndices.has(chainIndex)) residueIndices.push(residueIndex);
      });
    }
    // In case residue indices are passed we must convert them to atom indices
    if (residueIndices.length) {
      residueIndices = new Set(residueIndices);
      topologyData.atom_residue_indices.forEach((residueIndex, atomIndex) => {
        if (residueIndices.has(residueIndex)) atomIndices.push(atomIndex);
      });
    }
    // In case we have a selection, generate a mmCIF file with the whole system to feed NGL and parse the selection
    // Note that the structure endpoint does the same, so the same selection returns the same atoms in both
    if (selectionRequest) {
      // Get reference frame coordinates
      const frameCoordinates = await project.getFrameCoordinates(project.referenceFrame);
      if (frameCoordinates.error) return frameCoordinates;
      // Produce a mmCIF file using both the topology data and reference frame coordinates
      // Note that NGL reads the residue numbers from the author fields, where the requested numeration is written
      const mmcifContent = produceMmcif(applyNumbering(topologyData, numbering), frameCoordinates);
      if (mmcifContent.error) return mmcifContent;
      // Convert the mmCIF content to a buffer
      const bufferMmcif = Buffer.from(mmcifContent, 'utf-8');
      // Get selected atom indices in a specific format (a1-a1,a2-a2,a3-a3...)
      const nglIndices = await getAtomIndices(bufferMmcif, selectionRequest);
      if (!nglIndices || nglIndices.length === 0) return {
        headerError: BAD_REQUEST,
        error: 'Atoms selection is empty or wrong'
      };
      atomIndices.push(...nglIndices);
    }
  }
  // If any selection was requested but no atoms were matched, return an error
  if (anyNewSelection && atomIndices.length === 0) return {
    headerError: BAD_REQUEST,
    error: 'Your custom selection is matching no atoms'
  };
  // Set the ranged, unique and sorted atoms
  let rangedAtoms;
  // If atom indices were resolved from index params, convert to ranged format
  if (atomIndices.length) {
    const uniqueSorted = [...new Set(atomIndices)].sort((a, b) => a - b);
    rangedAtoms = rangeIndices(uniqueSorted);
  }
  // When there is a selection or frame query (e.g. .../files/trajectory?selection=x)
  const parsedRanges = rangedAtoms ? { y: rangedAtoms } : {}
  const range = handleRanges(request, parsedRanges, trajectoryDescriptor);
  // If something is wrong with ranges then return the error
  if (range.error) return range;
  // Get the number of atoms and frames
  const atomCount = range.y.nvalues;
  const frameCount = range.z.nvalues;
  // Some formats include the simulation box, when the project has it
  // Other formats (e.g. nc, dcd) store only box lengths and angles, which would be misleading for a rotated box
  // The box is not available in most projects, so its absence is not an error
  let boxRange;
  let boxDescriptor;
  if (transformFormat.includesBox) {
    boxDescriptor = await project.getBoxFileDescriptor();
    if (!boxDescriptor.error) {
      // Box and trajectory frames must match, otherwise the box would be wrongly assigned
      const boxFrameCount = boxDescriptor.metadata.z.length;
      const trajectoryFrameCount = trajectoryDescriptor.metadata.z.length;
      if (boxFrameCount !== trajectoryFrameCount) return {
        headerError: INTERNAL_SERVER_ERROR,
        error: `The box has ${boxFrameCount} frames but the trajectory has ${trajectoryFrameCount}`
      };
      // Select the same frames than in the trajectory
      // Note that the request is not passed, since other ranges (e.g. y, bytes) would mean something else here
      boxRange = handleRanges(null, { z: [...range.z] }, boxDescriptor);
      if (boxRange.error) return boxRange;
    }
  }
  // Set the final stream to be returned
  let stream;
  // Return a simple stream when asking for the whole file (i.e. range is not iterable)
  // Return an internally managed stream when asking for specific ranges
  const rangedStream = getRangedStream(bucket, trajectoryDescriptor._id, range);
  // Get the output format name
  const transformFormatName = transformFormat.name;
  // When user requests "crd" or "mdcrd" files
  if (transformFormatName === 'mdcrd') {
    // Set a title for the mdcrd file (i.e. the first line)
    const config = getConfig(request);
    let title = config.name + ' - ' + request.params.project;
    title += '\n';
    // Add an extra chunk with the title
    // WARNING: This is important for the correct parsing of this format
    // e.g. VMD skips the first line when reading this format
    const titleStream = Readable.from([title]);
    // Start a process to convert the original .bin file to .mdcrd format
    // Atom count is required to add the breakline between frames at the mdcrd format
    const transformStream = BinToMdcrdStream(atomCount);
    const lengthConverter = BinToMdcrdStream.CONVERTER;
    // Calculate the bytes length in the new format
    // WARNING: The size of the title must be included in the range (and then content-length)
    range.byteSize = lengthConverter(range.byteSize, atomCount) + Buffer.byteLength(title);
    // Set a new stream which is ready to be destroyed
    // It is destroyed when the .bin to .mdcrd process or the client request are over
    rangedStream.pipe(transformStream);
    transformStream.on('close', () => rangedStream.destroy());
    request.on('close', () => rangedStream.destroy());
    // Combine both the title and the main data streams
    let combined = new PassThrough();
    combined = titleStream.pipe(combined, { end: false });
    combined = transformStream.pipe(combined, { end: false });
    // WARNING: Do not use outputStream.emit('end') here!!
    // This could trigger the 'end' event before all data has been consumed by the next stream
    transformStream.once('end', () => combined.end());
    // Return the .bin to .mdcrd process stream
    stream = combined;
  } else if (
    transformFormatName === 'xtc' ||
    transformFormatName === 'trr' ||
    transformFormatName === 'nc' ||
    transformFormatName === 'dcd'
  ) {
    // Get the box stream, if any
    const boxStream = boxRange && getRangedStream(bucket, boxDescriptor._id, boxRange);
    // Use chemfiles to convert the trajectory from .bin to the requested format
    stream = chemfilesConverter(
      rangedStream,
      atomCount,
      frameCount,
      transformFormat.chemfilesName,
      boxStream,
    );
    // We can not predict the size of the resulting file (yet?)
    range.byteSize = null;
  } else if (transformFormatName === 'bin') {
    stream = rangedStream;
  } else throw new Error('Missing instructions to export format');
  // Set the output filename according to some standards
  const filename = setOutputFilename(project.data, trajectoryDescriptor, transformFormatName);
  return {
    stream,
    filename,
    trajectoryDescriptor,
    range,
    transformFormat,
    acceptRanges: ['bytes', 'atoms', 'frames'],
  };
};

// When trajectory is requested (i.e. .../trajectory)
// Note that trajectory may be requested both trough GET and POST methods
// POST method was implemented to allow long atom/frame selections
const trajectoryHandler = handler({
  supportedArguments: TRAJECTORY_ARGUMENTS,
  async retriever(request) {
    // Set the format in which data will be sent
    // Format is requested through the query
    // We check both the body (in case it is a POST) and the query (in case it is a GET)
    const formatRequest = request.body.format || request.query.format;
    const transformFormat = acceptTransformFormat(formatRequest);
    if (!transformFormat) return {
      headerError: BAD_REQUEST,
      error: 'ERROR: Not supported format. Choose one of these: ' +
        Object.keys(trajectoryFormats).join(', ')
    };
    return getTrajectory(request, transformFormat);
  },
  headers: streamHeaders,
  body: streamBody,
});

// When the trajectory coordinates are requested (i.e. .../trajectory/coordinates)
// Coordinates are always returned in .bin format, so there is no format argument
// Atom and frame selections are the same than in the trajectory endpoint
const coordinatesHandler = handler({
  supportedArguments: COORDINATES_ARGUMENTS,
  retriever: request => getTrajectory(request, trajectoryFormats.bin),
  headers: streamHeaders,
  body: streamBody,
});

// When the box is requested (i.e. .../trajectory/box)
// The box is returned in .bin format: 3 vectors of 3 float32 coordinates per frame
const boxHandler = handler({
  supportedArguments: BOX_ARGUMENTS,
  async retriever(request) {
    // Stablish database connection and retrieve our custom handler
    const database = await getDatabase(request);
    // Set the bucket, which allows downloading big files from the database
    const bucket = database.bucket;
    // Find the requested project data
    const project = await database.getProject();
    // If there was any problem then return the errors
    if (project.error) return project;
    // Download the box file descriptor
    const boxDescriptor = await project.getBoxFileDescriptor();
    // If the object ID is not found in the data base, return here
    if (boxDescriptor.error) return boxDescriptor;
    // Only frame selections are supported (e.g. .../trajectory/box?frames=1-10)
    const range = handleRanges(request, {}, boxDescriptor);
    // If something is wrong with ranges then return the error
    if (range.error) return range;
    // Return a simple stream when asking for the whole file (i.e. range is not iterable)
    // Return an internally managed stream when asking for specific ranges
    const stream = getRangedStream(bucket, boxDescriptor._id, range);
    // Set the output filename according to some standards
    const filename = setOutputFilename(project.data, boxDescriptor, 'bin');
    return {
      stream,
      filename,
      trajectoryDescriptor: boxDescriptor,
      range,
      transformFormat: trajectoryFormats.bin,
      acceptRanges: ['bytes', 'frames'],
    };
  },
  headers: streamHeaders,
  body: streamBody,
});

// Support both the http GET and POST methods
router.route('/').get(trajectoryHandler);
router.route('/').post(trajectoryHandler);
router.route('/coordinates').get(coordinatesHandler);
router.route('/coordinates').post(coordinatesHandler);
router.route('/box').get(boxHandler);
router.route('/box').post(boxHandler);

module.exports = router;