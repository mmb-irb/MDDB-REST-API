// Import some auxiliar functions
const { getValueGetter } = require('../auxiliar');

// Set a header present in all 
const REFERENCE_HEADER = 'references.';

// Set a function to apply any last changes to the results
// Here are the hardcodes to solve silly issues or not "good looking" numbers
// LORE: We no longer sort the final response, this is now done by the client
// LORE: You can not rely in objects order and returning everything as arrays is not efficient
const lastFixes = options => {
    // Remove MD interaction-analyses with the numerated name
    const mdAnalysesKey = 'mds.analyses.name';
    const numeratedAnalysisPattern = /-[0-9]*$/;
    if (mdAnalysesKey in options) {
        const mdAnalyses = options[mdAnalysesKey];
        Object.keys(mdAnalyses).forEach(key => {
            // If it ends in '-xx' where xx is any number of numeric characters
            if (key.match(numeratedAnalysisPattern)) delete mdAnalyses[key];
        });
    }
    // Return the modified object
    return options;
}

// Count the number of projects with the same values for every field
// WARNING: This function is used by both the API and the loader
// It is important that they use the same code so they are coordinated
const countOptions = async (database, query, fields, shouldCountMds, useSavedCounts) => {
    // Set the options object to be returned
    // Then all mined data will be written into it
    const options = {};
    // First of all check if we have already counted values for the requested query
    if (useSavedCounts) {
        // Note that the values for these fields have the dots replaced by '/' characters
        // This is more database friendly than dots
        // So we have to replace these characters to make the fields match
        const databaseFields = {};
        fields.forEach(field => { databaseFields[field] = field.replaceAll('.', '/') });
        // Set the projection to retrieve only the fields we need
        const fieldProjections = Object.fromEntries(fields.map(
            field => [`fields.${databaseFields[field]}`, true]));
        // Request the saved counts matching the query
        const savedCounter = await database.counters.findOne({ query: query },
            { projection: { _id: false, ...fieldProjections } });
        // Now store the saved counts in the final options response
        Object.entries(savedCounter.fields).forEach(([ field, optionCounts ]) => {
            const renamedField = field.replaceAll('/', '.');
            if (!shouldCountMds) Object.entries(optionCounts).forEach(([value, counts]) => {
                optionCounts[value] = counts[0];
            });
            options[renamedField] = optionCounts;
        });
    }
    // Now get the rest of fields which were not already among the saved ones
    const missingFields = fields.filter(field => !(field in options));
    // If there are no missing field left then we are done
    if (missingFields.length === 0) return lastFixes(options);
    // Options may be fields from projects or references collections
    // Fields in references are headed with the 'references.' label and they are handled separately
    // Start with options from references
    // In case there is any reference we must query the projects collections first
    const requestedProjections = { projects: [] };
    const availableReferences = Object.keys(database.REFERENCES);
    availableReferences.forEach(referenceName => { requestedProjections[referenceName] = [] });
    // Keep a set with the references included in the projection
    const requestedReferences = new Set();
    // First separate reference fields from project fields
    for (const field of missingFields) {
        // If this field has not the reference header either then it is a project field
        if (!field.startsWith(REFERENCE_HEADER)) {
            requestedProjections.projects.push(field);
            continue;
        }
        // Otherwise it is a reference field
        // Find the reference it belongs to
        const requestedReference = field.split('.')[1];
        // Make sure the reference exists
        if (!availableReferences.includes(requestedReference)) return {
            code: '400',
            error: `Unknown reference "${requestedReference}". Available references: ${availableReferences.join(', ')}`
        };
        // Make sure there is something after the reference name or we will have a mongo error later
        if (!field.split('.')[2]) return  {
            code: '400',
            error: `Empty reference field in "${field}". Please provide a field name after "${requestedReference}"`
        }
        // Add the requetsed reference to the set
        requestedReferences.add(requestedReference);
        // Add the requested field to its corresponding reference
        requestedProjections[requestedReference].push(field);
    }
    // First of all make the projects request
    // This requests has 2 goals
    // First, we get the project requested fields
    // Second, we get reference id fields to further count the number of matches per reference requested field
    // Set the projector according to the two previously explained goals
    // We will need internal ids if we have to request any reference field
    const projector = { _id: true };
    // If MDs are to be counted then return the MD count as well
    if (shouldCountMds) projector.mdcount = true;
    // Add requested project fields
    requestedProjections.projects.forEach(field => {
        projector[field] = true
    });
    // Add requested references id fields
    requestedReferences.forEach(referenceName => {
        const reference = database.REFERENCES[referenceName];
        projector[reference.projectIdsField] = true;
    });
    // Set the projects cursor
    const projectsCursor = await database.projects.find(query, { projection: projector });
    // Consume the projects cursor
    const projectsData = await projectsCursor.toArray();
    // If projects data is empty then stop here
    if (projectsData.length === 0) return {
        code: '404',
        error: `The result of ${(query && `query "${query}"`) || ''}${(query && search && ' and ') || ''}${(search && `search "${search}"`) || ''} is empty`
    }
    // Set an object with project md counts
    const projectMdCounts = {};
    if (shouldCountMds) projectsData.forEach(project => {
        projectMdCounts[project._id] = project.mdcount || 1;
    });
    // Start handling references options
    // First of all, make sure there was at least one reference projection request
    const anyReferenceProjectionRequest = requestedReferences.size > 0;
    if (anyReferenceProjectionRequest) {
        // Now iterate along the different references
        for await (const referenceName of requestedReferences) {
            // Get the reference configuration
            const reference = database.REFERENCES[referenceName];
            // Set a getter function for the project reference ids field
            const projectIdsGetter = getValueGetter(reference.projectIdsField);
            // Set a list of projects including every reference id
            const referenceIdProjects = {};
            for (const projectData of projectsData) {
            const projectReferenceIds = projectIdsGetter(projectData);
            if (!projectReferenceIds) continue;
            projectReferenceIds.forEach(referenceId => {
                if (referenceId in referenceIdProjects)
                referenceIdProjects[referenceId].push(projectData._id);
                else referenceIdProjects[referenceId] = [projectData._id];
            });
            }
            // Get the requested projection fields for the current reference
            // Remove both the reference header and the reference name from every field to get the actual fields
            // e.g. 'references.proteins.name' -> 'name'
            const referenceRequestedProjections = requestedProjections[referenceName].map(
                field => field.split('.').slice(2).join('.')
            );
            // Set the references projector
            const referencesProjector = { _id: false };
            // Get reference ids to associate values further
            referencesProjector[reference.idField] = true;
            // Get every requested projection field
            referenceRequestedProjections.forEach(field => {
                referencesProjector[field] = true;
            });
            // Get all references using the custom projector
            const collection = database[reference.collectionName];
            const referencesCursor = await collection.find(
                {}, // Get all references, independently from the request origin
                // Discard the heaviest fields we do not need anyway
                { projection: referencesProjector },
            );
            // Consume the references cursor
            const referencesData = await referencesCursor.toArray();
            // Now for each field, get the different available values and the reference ids on each value
            // Then count how many times any of those reference ids is in the project references list
            referenceRequestedProjections.forEach(field => {
                const referenceIdsPerValue = {};
                // Set a function to mine values
                const getValues = (object, steps, referenceId) => {
                    let value = object;
                    for (const [index, step] of steps.entries()) {
                    // Get the actual value
                    value = value[step];
                    if (value === undefined) return;
                    // In case it is an array search for the remaining steps on each element
                    if (Array.isArray(value)) {
                        const remainingSteps = steps.slice(index + 1);
                        value.forEach(element =>
                        getValues(element, remainingSteps, referenceId),
                        );
                        return;
                    }
                    }
                    // If the value is a string then make it lower caps
                    // This way we avoid having duplicated values because of different capitalizatioin
                    // This is quiet common in PDB annotations (organism, method, etc.)
                    if (typeof value === 'string') value = value.toLowerCase();
                    // If the value exists and it is not an array then add it to the list
                    // First create an empty list in case this is the first time we find this value
                    if (!referenceIdsPerValue[value]) referenceIdsPerValue[value] = [];
                    // Then add the reference id to the list
                    referenceIdsPerValue[value].push(referenceId);
                };
                // Run the actual values mining
                const fieldSteps = field.split('.');
                referencesData.forEach(referenceData => {
                    const referenceId = referenceData[reference.idField];
                    // If the reference id is not among the projects recap then skip it
                    // There will be no matches from it anyway
                    // This may happen when we do not target the whole database
                    if (!(referenceId in referenceIdProjects)) return;
                    getValues(referenceData, fieldSteps, referenceData[reference.idField])
                });
                // Convert every reference ids list in the count of projects including any of these reference ids
                const valueCounts = {};
                Object.entries(referenceIdsPerValue).forEach(([value, referenceIds]) => {
                    // Now for each value get all associated project ids
                    let valueProjects = [];
                    referenceIds.forEach(referenceId => {
                        valueProjects = valueProjects.concat(referenceIdProjects[referenceId]);
                    });
                    // Get unique project ids
                    const uniqueValueProjects = new Set(valueProjects);
                    const projectCount = uniqueValueProjects.size;
                    // If the count is 0 then skip this value entirely
                    // This may happen when a reference is orphan (i.e. its associated projects were deleted)
                    if (projectCount === 0) return;
                    // Count MDs if requested
                    if (shouldCountMds) {
                        const mdCount = Array.from(uniqueValueProjects).reduce(
                            (accumulated, projectId) => accumulated + projectMdCounts[projectId], 0);
                        valueCounts[value] = [projectCount, mdCount];
                    }
                    else {
                        valueCounts[value] = projectCount;
                    }
                });
                // Add current value counts to the options object to be returned
                const originalFieldName = `${REFERENCE_HEADER}${referenceName}.${field}`;
                options[originalFieldName] = valueCounts;
            });
        }
    }
    // Now handle project options
    if (requestedProjections.projects.length !== 0) {
        // For each projected field, get the counts
        requestedProjections.projects.forEach(field => {
            // For each different value, save all project ids from projects including it
            // This allows us to not count the same project twice
            const values = {};
            // Set a recursive function to reach indented values
            const getValues = (object, steps, projectId) => {
                let value = object;
                for (const [index, step] of steps.entries()) {
                    value = value[step];
                    if (value === undefined) return;
                    // In case it is an array search for the remaining steps on each element
                    if (Array.isArray(value)) {
                        const remainingSteps = steps.slice(index + 1);
                        value.forEach(element => getValues(element, remainingSteps, projectId));
                        return;
                    }
                }
                // Get the set of projects with the current value and update it
                const currentValueProjects = values[value];
                if (currentValueProjects) currentValueProjects.add(projectId);
                else values[value] = new Set([ projectId ]);
            };
            // Start the recursive function here
            const fieldSteps = field.split('.');
            projectsData.forEach(projectData => getValues(projectData, fieldSteps, projectData._id));
            // Count how many times is repeated each value and save the number with the fieldname key
            const counts = {};
            if (shouldCountMds) Object.entries(values).forEach(([value, projectIds]) => {
                const projectCount = projectIds.size;
                const mdCount = Array.from(projectIds).reduce(
                    (accumulated, projectId) => accumulated + projectMdCounts[projectId], 0);
                counts[value] = [projectCount, mdCount];
            });
            else Object.entries(values).forEach(([value, projectIds]) => { counts[value] = projectIds.size });
            // Add current field counts to the overall options object to be returned
            options[field] = counts;
        });
    }
    // Send all mined data while we apply the last fixes
    return lastFixes(options);
}

module.exports = countOptions;