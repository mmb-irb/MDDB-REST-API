// Standard HTTP response status codes
const { NOT_FOUND } = require('../../utils/status-codes');
// Import references configuration
const { REFERENCES } = require('../../utils/constants');
// Get auxiliar functions
const { getValueGetter } = require('../../utils/auxiliar-functions');

// Set the project class
class Project {
    constructor (data, database) {
        // Store the current project data
        this.data = data;
        this.accession = this.data.accession;
        this.id = this.data._id;
        // Store the database handler
        this.database = database;
        // Keep track of the currently inserting file
        // This way, in case anything goes wrong, we can delete orphan chunks
        this.currentUploadId = null;
    };

    // Get topology data
    getTopologyData = async () => {
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
        // Send the analysis data
        return topologyData;
    }

    // Get analysis data
    getAnalysisData = async name => {
        // Query the database and retrieve the requested analysis
        const analysisData = await this.database.analyses.findOne(
            // Set the query
            { project: this.data.internalId, md: this.data.mdIndex, name },
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
            const projectReferenceIds = valueGetter(this.data);
            // If there are no references then send an empty list
            if (!projectReferenceIds || projectReferenceIds.length == 0) continue;
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

}

module.exports = Project