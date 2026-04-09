// Standard HTTP response status codes
const { NOT_FOUND } = require('../../utils/status-codes');
// Import references configuration
const { REFERENCES, STANDARD_TRAJECTORY_FILENAME } = require('../../utils/constants');
// Get auxiliar functions
const { getValueGetter } = require('../../utils/auxiliar-functions');
// Get tools to handle range queries
const handleRanges = require('../../utils/handle-ranges');
const { rangeIndices } = require('../../utils/parse-query-range');
// Returns a simple stream when asking for the whole file
// Returns an internally managed stream when asking for specific ranges
const getRangedStream = require('../../utils/get-ranged-stream');
// Standard HTTP response status codes
const { INTERNAL_SERVER_ERROR } = require('../../utils/status-codes');

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
    getTopologyData = async (raw = false) => {
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
        // If the topology is requested raw then return it as is
        if (raw === true) return topologyData;
        // Otherwise we must make a few changes before returning it
        // Check if atom charges are "per MD" and, if this is the case, then return only the values for the corresponding MD
        const atomCharges = topologyData['atom_charges'];
        if (atomCharges && atomCharges.mdmap && atomCharges.values) {
            const valueIndex = atomCharges.mdmap[this.mdIndex];
            topologyData['atom_charges'] = atomCharges.values[valueIndex];
        }
        // Send the processed analysis data
        return topologyData;
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
        for await (const [referenceName, reference] of Object.entries(REFERENCES)) {
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
            const cursor = await this.database[referenceName].find(
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
        const nAtoms = sortedAtomIndices ? sortedAtomIndices.length : trajectoryDescriptor.atoms;
        const nCoordinates = nAtoms * 3;
        if (bufferSize != nCoordinates * 4) return {
            headerError: INTERNAL_SERVER_ERROR,
            error: 'Unexpected buffer size in frame coordinates'
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
        // If we had no match tehn return an error
        return {
            headerError: NOT_FOUND,
            error: `File descriptor for "${filename}" was not found in the files collection`
        };
        
    }

    // Get the trajectory file descriptor
    // Note that we add few metadata values to adapt it to the "dimensions" format
    getTrajectorFileDescriptor = async () => {
        // Get the file descriptor
        const fileDescriptor = await this.getFileDescriptor(STANDARD_TRAJECTORY_FILENAME);
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

}

module.exports = Project