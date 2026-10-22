// Standard HTTP response status codes
const { NOT_FOUND } = require('../../utils/status-codes');
// Get auxiliar functions
const { getValueGetter } = require('../../utils/auxiliar-functions');
// Import version handler
const Version = require('../../utils/version');
// Function to consume a stream entirely
const consumeStream = require('../../utils/consume-stream');
// Get tools to handle range queries
const handleRanges = require('../../utils/handle-ranges');
const { rangeIndices } = require('../../utils/parse-query-range');
// Returns a simple stream when asking for the whole file
// Returns an internally managed stream when asking for specific ranges
const getRangedStream = require('../../utils/get-ranged-stream');
// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR, BAD_REQUEST } = require('../../utils/status-codes');
// Tools to handle topology data
const { MISSING_BONDS, ATOM_FIELDS, RESIDUE_FIELDS, sortedUnique, duplicateBonds, subsetTopology } = require('../../utils/topology-tools');

// Set the flag used in the topology to state that a field is in GridFS
const BIN_FLAG = 'gridfs';
// Supported data types for topology binary files
const BINARY_TYPES = {
    float32: Float32Array,
    float64: Float64Array,
    uint16: Uint16Array,
    uint32: Uint32Array,
    int32: Int32Array,
};

// Set the project class
class Project {
    constructor (data, database) {
        // Store the current project data
        this.data = data;
        this.accession = this.data.accession;
        this.mdIndex = this.data.mdIndex;
        this.id = this.data._id;
        // Store the database handler
        this.database = database;
        // Keep track of the currently inserting file
        // This way, in case anything goes wrong, we can delete orphan chunks
        this.currentUploadId = null;
    };

    // Return the reference frame
    // If there is no reference frame (old projects) then resturn the first frame
    get referenceFrame () {
        const referenceFrame = this.data.refframe;
        if (referenceFrame === undefined) return 0;
        return referenceFrame;
    }

    // Get topology data
    // You may request specific fields only
    // You may also request a selection of atom, residue and/or chain indices
    // In this case the topology is reduced to the selected atoms and all indices are renumbered
    // Bonds are given only in one of the two bonded atoms unless duplicated bonds are requested
    getTopologyData = async (fields, selection = {}, duplicatedBonds = false) => {
        const { atomIndices = [], residueIndices = [], chainIndices = [] } = selection;
        // Query the database and retrieve the requested topology
        const topologyData = await this.database.topologies.findOne(
            // Set the query
            { project: this.data.internalId },
            // Skip some useless values
            { projection: { _id: false, project: false } },
        );
        // If no topology was found then return here
        if (!topologyData) return {
            headerError: NOT_FOUND,
            error: `Project ${this.accession} has no topology`
        };
        // Make a copy of the original data so we do not mutate the original
        let topology = { ...topologyData };
        // Set which fields we need, including the ones needed to build the requested fields
        const isRequested = field => !fields || fields.has(field);
        const isNeeded = field => {
            if (isRequested(field)) return true;
            if (field === 'atom_species_indices') return isRequested('atom_names') || isRequested('atom_elements');
            if (field === 'residue_species_indices') return isRequested('residue_names');
            if (field === 'residue_reference_indices') return isRequested('references') || isRequested('reference_types');
            return false;
        };
        // In large systems some per-atom and per-residue fields are stored in GridFS as binary files
        // When there is a selection we read only the values of the selected atoms and their residues
        let selectedAtomIndices;
        let atomRanges;
        let residueRanges;
        let allAtomResidueIndices;
        let allResidueChainIndices;
        if (atomIndices.length > 0 || residueIndices.length > 0 || chainIndices.length > 0) {
            // Residue indices of all atoms and chain indices of all residues are needed to resolve the selection
            allAtomResidueIndices = topology['atom_residue_indices'] === BIN_FLAG
                ? await this.loadTopologyField('atom_residue_indices')
                : topology['atom_residue_indices'];
            allResidueChainIndices = topology['residue_chain_indices'] === BIN_FLAG
                ? await this.loadTopologyField('residue_chain_indices')
                : topology['residue_chain_indices'];
            // Make sure all requested indices exist
            const counts = {
                atom: [ atomIndices, allAtomResidueIndices.length ],
                residue: [ residueIndices, allResidueChainIndices.length ],
                chain: [ chainIndices, topology['chain_names'].length ],
            };
            for (const [ name, [ indices, count ] ] of Object.entries(counts)) {
                const wrongIndices = indices.filter(index => !Number.isInteger(index) || index < 0 || index >= count);
                if (wrongIndices.length > 0) return {
                    headerError: BAD_REQUEST,
                    error: `Wrong ${name} indices: ${wrongIndices.slice(0, 10).join(', ')}. There are ${count} ${name}s.` +
                        ' Indices must be positive integers (0-based) or ranges of them (e.g. 0-9,12).'
                };
            }
            // Find the atoms of the selected chains and residues
            const selectedChains = new Set(chainIndices);
            const selectedResidues = new Set(residueIndices);
            allResidueChainIndices.forEach((chainIndex, residueIndex) => {
                if (selectedChains.has(chainIndex)) selectedResidues.add(residueIndex);
            });
            const selectedAtoms = new Set(atomIndices);
            allAtomResidueIndices.forEach((residueIndex, atomIndex) => {
                if (selectedResidues.has(residueIndex)) selectedAtoms.add(atomIndex);
            });
            if (selectedAtoms.size === 0) return {
                headerError: BAD_REQUEST,
                error: 'Your custom selection is matching no atoms'
            };
            selectedAtomIndices = [...selectedAtoms].sort((a, b) => a - b);
            const selectedResidueIndices = sortedUnique(selectedAtomIndices.map(atomIndex => allAtomResidueIndices[atomIndex]));
            atomRanges = rangeIndices(selectedAtomIndices);
            residueRanges = rangeIndices(selectedResidueIndices);
            // Keep only the selected atoms and their residues in fields which are in the topology itself
            // Values are not renumbered yet
            topology['atom_residue_indices'] = allAtomResidueIndices;
            topology['residue_chain_indices'] = allResidueChainIndices;
            ATOM_FIELDS.forEach(field => {
                if (!Array.isArray(topology[field])) return;
                topology[field] = selectedAtomIndices.map(atomIndex => topology[field][atomIndex]);
            });
            RESIDUE_FIELDS.forEach(field => {
                if (!Array.isArray(topology[field])) return;
                topology[field] = selectedResidueIndices.map(residueIndex => topology[field][residueIndex]);
            });
        }
        // Check if atom charges are "per MD" and, if this is the case, then return only the values for the corresponding MD
        const atomCharges = topology['atom_charges'];
        if (atomCharges && atomCharges.mdmap && atomCharges.values && isRequested('atom_charges')) {
            const valueIndex = atomCharges.mdmap[this.mdIndex];
            const charges = atomCharges.values[valueIndex];
            topology['atom_charges'] = selectedAtomIndices && charges
                ? selectedAtomIndices.map(atomIndex => charges[atomIndex])
                : charges;
        }
        // Load fields which are in GridFS
        for (const field of ATOM_FIELDS) {
            if (topology[field] !== BIN_FLAG || !isNeeded(field)) continue;
            if (field === 'atom_bonds') topology[field] = await this.loadBinaryBonds(atomRanges);
            else if (field === 'atom_charges') topology[field] = await this.loadBinaryCharges(atomRanges);
            else topology[field] = await this.loadTopologyField(field, atomRanges);
        }
        for (const field of RESIDUE_FIELDS) {
            if (topology[field] !== BIN_FLAG || !isNeeded(field)) continue;
            topology[field] = await this.loadTopologyField(field, residueRanges);
        }
        // New topology format:
        // Instead of atom_names and atom_elements we may have atom_species and atom_species_indices
        // Parse these here so the API response is still compliant with the old format
        const atomSpecies = topology['atom_species'];
        if (atomSpecies && (isRequested('atom_names') || isRequested('atom_elements'))) {
            const atomNames = [];
            const atomElements = [];
            topology['atom_species_indices'].forEach(atomSpeciesIndex => {
                const [ atomName, atomElement ] = atomSpecies[atomSpeciesIndex];
                atomNames.push(atomName);
                atomElements.push(atomElement);
            });
            // Get rid of raw values
            delete topology['atom_species'];
            delete topology['atom_species_indices'];
            // Set the new values
            // Do it in a way that they come in first, to respect the original order
            topology = Object.assign({ 'atom_names': atomNames, 'atom_elements': atomElements }, topology);
        }
        // The same happens with residue names, which may come as residue_species and residue_species_indices
        const residueSpecies = topology['residue_species'];
        if (residueSpecies && isRequested('residue_names')) {
            topology['residue_names'] = topology['residue_species_indices'].map(index => residueSpecies[index]);
            delete topology['residue_species'];
            delete topology['residue_species_indices'];
        }
        // Renumber all indices in the reduced topology
        if (selectedAtomIndices) topology = subsetTopology(topology, selectedAtomIndices,
            allAtomResidueIndices, allResidueChainIndices);
        // Since version 0.1 bonds are given only in one of the two bonded atoms
        // Add them also to the other atom if requested
        const version = new Version(topology['version']);
        const hasSingleBonds = version.greaterThan('0.1') || version.equals('0.1');
        if (duplicatedBonds && hasSingleBonds && Array.isArray(topology['atom_bonds']))
            topology['atom_bonds'] = duplicateBonds(topology['atom_bonds']);
        if ( fields === null || fields === undefined ) return topology;
        // Remove all fields which were not requested
        const finalTopology = {};
        fields.forEach(field => { finalTopology[field] = topology[field] });
        // Send the processed analysis data
        return finalTopology;
    }

    // Load a topology field from its binary file in GridFS
    // Ranges of value indices may be passed to download only these values (both start and end are included)
    // Missing values are flagged in the binary file with a specific value, which is replaced by null
    loadTopologyField = async (field, ranges) => {
        const descriptor = await this.getFileDescriptor(`${field}.bin`);
        if (descriptor.error) throw new Error(`Topology field ${field} is in GridFS but its file is missing: ${descriptor.error}`);
        const values = Array.from(await this.loadBinaryValues(descriptor, undefined, ranges));
        const missing = descriptor.metadata.missing;
        if (missing === undefined) return values;
        return values.map(value => value === missing ? null : value);
    }

    // Charges of every MD are in a different file, which metadata says the MDs it belongs to
    // Atom ranges may be passed to download only the charges of these atoms
    loadBinaryCharges = async atomRanges => {
        const chargesDescriptor = await this.database.files.findOne({
            'metadata.project': this.data.internalId,
            filename: { $regex: 'atom_charges' },
            'metadata.mds': this.mdIndex,
        });
        if (!chargesDescriptor) throw new Error(`Atom charges are in GridFS but the file for MD ${this.mdIndex} is missing`);
        // Old charges files have no data type in their metadata but they are always float32
        return Array.from(await this.loadBinaryValues(chargesDescriptor, 'float32', atomRanges));
    }

    // Download a binary file and parse its values according to the data type in its metadata
    // A default data type may be passed for old files with no data type in their metadata
    // Ranges of value indices may be passed to download only these values (both start and end are included)
    loadBinaryValues = async (descriptor, defaultDtype, ranges) => {
        const dtype = descriptor.metadata.dtype || defaultDtype;
        const TypedArray = BINARY_TYPES[dtype];
        if (!TypedArray) throw new Error(`Not supported data type "${dtype}" in binary file ${descriptor.filename}`);
        if (ranges && ranges.length === 0) return new TypedArray(0);
        const valueSize = TypedArray.BYTES_PER_ELEMENT;
        const byteRanges = ranges && ranges.map(({ start, end }) => ({ start: start * valueSize, end: (end + 1) * valueSize - 1 }));
        const stream = getRangedStream(this.database.bucket, descriptor._id, byteRanges);
        const buffer = await consumeStream(stream);
        // Copy the bytes since the buffer may be a piece of a bigger memory block
        // In that case values would not be aligned and reading the whole block would return wrong values
        const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
        return new TypedArray(bytes);
    }

    // Bonds come in two binary files: the bonds of atom i are bonds[offsets[i]:offsets[i+1]]
    // Atoms with missing bonds have a single bond with a flag value
    // Ranges of atom indices may be passed to download only the bonds of these atoms
    loadBinaryBonds = async atomRanges => {
        const offsetsDescriptor = await this.getFileDescriptor('atom_bond_offsets.bin');
        if (offsetsDescriptor.error) throw new Error(`Atom bonds are in GridFS but their file is missing: ${offsetsDescriptor.error}`);
        const bondsDescriptor = await this.getFileDescriptor('atom_bonds.bin');
        if (bondsDescriptor.error) throw new Error(`Atom bonds are in GridFS but their file is missing: ${bondsDescriptor.error}`);
        // Every range of atoms needs one more offset, which is where the bonds of its last atom end
        const offsetRanges = atomRanges && atomRanges.map(({ start, end }) => ({ start, end: end + 1 }));
        const offsets = await this.loadBinaryValues(offsetsDescriptor, undefined, offsetRanges);
        // Split the offsets of every range of atoms
        const rangeOffsets = [];
        if (!atomRanges) rangeOffsets.push(offsets);
        else {
            let position = 0;
            atomRanges.forEach(({ start, end }) => {
                const offsetCount = end - start + 2;
                rangeOffsets.push(offsets.subarray(position, position + offsetCount));
                position += offsetCount;
            });
        }
        // Download the bonds of every range of atoms, skipping ranges with no bonds at all
        const bondRanges = atomRanges && rangeOffsets
            .filter(offsets => offsets[offsets.length - 1] > offsets[0])
            .map(offsets => ({ start: offsets[0], end: offsets[offsets.length - 1] - 1 }));
        const bonds = await this.loadBinaryValues(bondsDescriptor, undefined, bondRanges);
        // Bonds come one after the other so we get the bonds of every atom using the number of bonds in the offsets
        const binMissingBonds = bondsDescriptor.metadata.missing;
        const atomBonds = [];
        let position = 0;
        rangeOffsets.forEach(offsets => {
            for (let i = 0; i < offsets.length - 1; i++) {
                const bondCount = offsets[i + 1] - offsets[i];
                const bonded = Array.from(bonds.subarray(position, position + bondCount));
                position += bondCount;
                if (bonded.length === 1 && bonded[0] === binMissingBonds) atomBonds.push(MISSING_BONDS);
                else atomBonds.push(bonded);
            }
        });
        return atomBonds;
    }

    // Get analysis data
    getAnalysisData = async name => {
        // Query the database and retrieve the requested analysis
        const analysisData = await this.database.analyses.findOne(
            // Set the query
            { project: this.data.internalId, md: { $in: [ undefined, this.mdIndex ] }, name },
            // Skip some useless values
            { projection: { _id: false, name: false, project: false, md: false } },
        );
        // If we did not found the analysis then return a not found error
        // Get the list of available analyses for this project to provide more help
        if (!analysisData) return {
            headerError: NOT_FOUND,
            error: `Analysis "${name}" not found. Project ${
                this.accession
            } has the following available analyses: ${ this.data.analyses.join(', ') }`
        };
        // Send the analysis data
        return analysisData.value;
    }

    // Get reference data
    getReferenceData = async () => {
        // Set an array with all references
        let allReferences = [];
        // Iterate the different refernece types
        for await (const [referenceName, reference] of Object.entries(this.database.REFERENCES)) {
            // Set a nested value miner
            const valueGetter = getValueGetter(reference.projectIdsField);
            let projectReferenceIds = valueGetter(this.data);
            // If there are no references then send an empty list
            if (!projectReferenceIds || projectReferenceIds.length == 0) continue;
            // DANI: projectReferenceIds debería ser una lista, pero por si acaso es un string...
            if (typeof projectReferenceIds === 'string') projectReferenceIds = [projectReferenceIds];
            // Set up the db query with all reference ids
            const queries = projectReferenceIds.map(referenceId => {
                return { [reference.idField]: referenceId };
            });
            // Otherwise, find the corresponding references in the database and send their data
            const cursor = await this.database[reference.collectionName].find(
                { $or: queries },
                // But do not return the _id
                { projection: { _id: false } },
            );
            // Get reference data for all references of the current type
            const referencesData = await cursor.toArray();
            // Tag these references with its types
            referencesData.forEach(ref => { ref.ref_type = referenceName });
            // Add current references to the overall list
            allReferences = allReferences.concat(referencesData)
        }
        return allReferences;
    }

    // Get coordinates from a specific frame
    // If no frame is specified then the reference frame is used
    getFrameCoordinates = async (frame, atomIndices) => {
        // Set the target frame to be download
        const targetFrame = frame === undefined ? this.referenceFrame : frame;
        // Set ranges depending on the frame and atom indices requested
        const parsedRanges = { z: [ { start: targetFrame, end: targetFrame } ] };
        // Make sure atom indices are ranged
        const sortedAtomIndices = atomIndices && atomIndices.sort((a,b) => a - b);
        // Get ranged atom indices
        const rangedAtoms = sortedAtomIndices && rangeIndices(sortedAtomIndices);
        if (rangedAtoms) parsedRanges.y = rangedAtoms;
        // Download the main trajectory file descriptor
        const trajectoryDescriptor = await this.getTrajectorFileDescriptor();
        // Set byte ranges depending on the frame and atom indices requested
        const range = handleRanges(null, parsedRanges, trajectoryDescriptor);
        // If something is wrong with ranges then return the error
        if (range.error) return range;
        // Return a simple stream when asking for the whole file (i.e. range is not iterable)
        // Return an internally managed stream when asking for specific ranges
        const rangedStream = getRangedStream(this.database.bucket, trajectoryDescriptor._id, range);
        // Now consume the stream as binary values
        const chunks = [];
        await new Promise((resolve, reject) => {
            rangedStream.on('data', chunk => chunks.push(Buffer.from(chunk)));
            rangedStream.on('error', err => reject(err));
            rangedStream.on('end', () => resolve());
        });
        // Join raw coordinates in a single buffer
        const rawCoordinates = Buffer.concat(chunks);
        // Buffer size must be equal to the number of coordinates * the number of bytes per coordinate (4)
        const bufferSize = rawCoordinates.length;
        const nAtoms = sortedAtomIndices ? sortedAtomIndices.length : trajectoryDescriptor.metadata.atoms;
        const nCoordinates = nAtoms * 3;
        const nBytes = nCoordinates * 4;
        if (bufferSize != nBytes) return {
            headerError: INTERNAL_SERVER_ERROR,
            error: `Unexpected buffer size in frame coordinates. It is ${bufferSize} while it should be ${nBytes}`
        }
        // Parse binary values to float32 numeric values
        // Store coordinates in lists of 3 values (x,y,z) thus representing each atom coordinates
        const coordinates = [];
        for (let c = 0; c < nCoordinates; c++) {
            const readByte = c * 4;
            const parseCoordinate = rawCoordinates.readFloatLE(readByte);
            if (c % 3 === 0) coordinates.push([parseCoordinate]);
            else coordinates[coordinates.length - 1].push(parseCoordinate);
        }
        return coordinates;
    }

    // Get all file descriptors across all MDs
    // Results may be filtered by filenames
    // DANI: This is used by the monitor to check essential files in other nodes
    getAllMdsFileDescriptors = async (filenames = null) => {
        // Set the MD files query by targeting files with the current MD index
        // Set the project query
        const filesQuery = { 'metadata.project': this.data.internalId };
        // If any filename is passed then add it to the query
        if (filenames) filesQuery['filename'] = { $in: filenames };
        // Query the database
        const filesCursor = await this.database.files.find(filesQuery);
        // Consume the cursor
        const fileDescriptors = await filesCursor.toArray();
        // If there are no files at the end of the process then return an error
        if (fileDescriptors.length === 0) return {
            headerError: NOT_FOUND,
            error: `No files were found`
        };
        return fileDescriptors;
    }

    // Get all file descriptors
    getFileDescriptors = async () => {
        // Set the MD files query by targeting files with the current MD index
        const mdFilesQuery = { 'metadata.project': this.data.internalId, 'metadata.md': this.mdIndex };
        // Query the database
        const mdFilesCursor = await this.database.files.find(mdFilesQuery);
        // Consume the cursor
        const mdFileDescriptors = await mdFilesCursor.toArray();
        // Set the project files query by targeting files with null MD index
        const projectFilesQuery = { 'metadata.project': this.data.internalId, 'metadata.md': null };
        // Query the database
        const projectFilesCursor = await this.database.files.find(projectFilesQuery);
        // Consume the cursor
        const projectFileDescriptors = await projectFilesCursor.toArray();
        // Add project files to the MD files ONLY if there is not already a file with the same name among them
        const mdFilenames = new Set(mdFileDescriptors.map(descriptor => descriptor.filename));
        projectFileDescriptors.forEach(descriptor => {
            if (mdFilenames.has(descriptor.filename)) return;
            mdFileDescriptors.push(descriptor);
        })
        // If there are no files at the end of the process then return an error
        if (mdFileDescriptors.length === 0) return {
            headerError: NOT_FOUND,
            error: `No files were found`
        };
        return mdFileDescriptors;
    }

    // Get a file descriptor
    getFileDescriptor = async filename => {
        if (!filename) throw new Error('Missing filename');
        // Set the MD file query by targeting files with the current MD index
        const mdFileQuery = {
            'filename': filename,
            'metadata.project': this.data.internalId,
            'metadata.md': this.mdIndex,
        };
        // Query the database
        const mdFileDescriptor = await this.database.files.findOne(mdFileQuery);
        // If we found a result then return it
        if (mdFileDescriptor) return mdFileDescriptor;
        // Othrwise try with the project files
        // Set the project file query by targeting files with null MD index
        const projectFileQuery = {
            'filename': filename,
            'metadata.project': this.data.internalId,
            'metadata.md': null,
        };
        // Query the database
        const projectFileDescriptor = await this.database.files.findOne(projectFileQuery);
        // If we found a result then return it
        if (projectFileDescriptor) return projectFileDescriptor;
        // If we had no match then return an error
        return {
            headerError: NOT_FOUND,
            error: `File descriptor for "${filename}" was not found in the files collection`
        };
        
    }

    // Get the trajectory file descriptor
    // Note that we add few metadata values to adapt it to the "dimensions" format
    getTrajectorFileDescriptor = async () => {
        // Get the file descriptor
        const fileDescriptor = await this.getFileDescriptor(this.database.STANDARD_TRAJECTORY_FILENAME);
        // If there was any problem then return here
        if (fileDescriptor.error) return fileDescriptor;
        // Modify the descriptor to adapt it to the "dimensions" format
        fileDescriptor.metadata.x = { name: 'coords', length: 3 };
        fileDescriptor.metadata.y = { name: 'atoms', length: fileDescriptor.metadata.atoms };
        fileDescriptor.metadata.z = { name: 'frames', length: fileDescriptor.metadata.frames };
        fileDescriptor.metadata.bitsize = 32;
        // Return the modified descriptor
        return fileDescriptor;
    }

    // Get the box file descriptor
    // The box file stores the 3 box vectors (3 coordinates each) for every frame
    // Note that we add few metadata values to adapt it to the "dimensions" format
    getBoxFileDescriptor = async () => {
        // Get the file descriptor
        const fileDescriptor = await this.getFileDescriptor(this.database.STANDARD_BOX_FILENAME);
        // If there was any problem then return here
        if (fileDescriptor.error) return fileDescriptor;
        // Modify the descriptor to adapt it to the "dimensions" format
        fileDescriptor.metadata.x = { name: 'coords', length: 3 };
        fileDescriptor.metadata.y = { name: 'vectors', length: 3 };
        fileDescriptor.metadata.z = { name: 'frames', length: fileDescriptor.metadata.frames };
        fileDescriptor.metadata.bitsize = 32;
        // Return the modified descriptor
        return fileDescriptor;
    }

}

module.exports = Project