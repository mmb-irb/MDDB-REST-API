// Library to read yaml files
const yaml = require('yamljs');
// Get the configuration parameters for the different requesting hosts
const hostConfig = yaml.load(`${__dirname}/../../../config.yml`).hosts;

// Functions to be used widely along the code

// Get the request original URL
// DISCLAIMER: There is no straight forward way to reconstruct the original URL
// DISCLAIMER: However this should work most of the times
const getRequestUrl = request => {
    // The host is not always to be trusted. Some proxies overwrite it as 'localhost' or 'rest'
    const host = request.get('host');
    const isLocalHost = host === 'localhost:8000'
    // The request.protocol may be 'http' when using 'https' do not trust it
    const protocol = isLocalHost ? 'http' : 'https';
    // There is no easy way to know where the API is, under the host URL
    // In our nodes the structure is clear, but in others theis may change
    const hostEndpoint = isLocalHost ? '' : '/api';
    // This is the only value to be trusted
    const apiEndpoint = request.originalUrl;
    return `${protocol}://${host}${hostEndpoint}${apiEndpoint}`;
}

// Try to parse JSON and return the bad request error in case it fails
const parseJSON = string => {
    try {
        const parse = JSON.parse(string);
        if (parse && typeof parse === 'object') return parse;
    } catch (e) {
        return false;
    }
};

// Set a function to ckeck if a string is a mongo internal id
// WARNING: Do not use the builtin 'ObjectId.isValid'
// WARNING: It returns true with whatever string 12 characters long
const isObjectId = string => /^[a-z0-9]{24}$/.test(string);

// Set a function to check if an object is iterable
const isIterable = obj => {
    if (!obj) return false;
    return typeof obj[Symbol.iterator] === 'function';
};

// Set output filename
const setOutputFilename = (projectData, descriptor, forcedFormat = null) => {
    // Set the prefix
    // Add the id or accession as prefix but replacing non filename-friendly characters
    let prefix = (projectData.accession || projectData.internalId.toString()).replace(':','_');
    if (descriptor.metadata.md !== null) prefix += '.' + (descriptor.metadata.md + 1);
    // Set the initial filename
    let filename = prefix + '_' + descriptor.filename;
    // If format is forced then edit the final filename
    if (forcedFormat) {
        const splits = filename.split('.');
        // If the filename has no format/extension sufix then just add the format
        if (splits.length === 1) filename += forcedFormat;
        // Otherwise we must delete the old format before we add the new format
        else {
            const oldFormat = splits[splits.length - 1];
            const charactersToRemove = oldFormat.length + 1; // The +1 stands for the dot
            filename = filename.substring(0, filename.length - charactersToRemove) + '.' + forcedFormat;
        }
    }
    return filename;
};

// Set a function to build value getters with specific nesting paths
// Each nested step is separated by a dot
// e.g. 'metadata.LIGANDS' -> { metadata: { LIGANDS: <target value> } } 
const getValueGetter = path => {
    if (!path) throw new Error('Value getter has no path');
    // Split the path in its nested steps
    const steps = path.split('.');
    // Build the getter function
    const valueGetter = object => {
        let lastObject = object;
        for (const step of steps) {
            lastObject = lastObject[step]
            if (lastObject === undefined) return;
        }
        return lastObject;
    }
    return valueGetter;
};

// Get the request host
// This may be read from the request itself or it may be forced in the environment
// IMPORTANT: Make sure to always use this function to get the host to have a coherent behaviour
// NEVER FORGET: For the host to be inherited you may need to configure your apache
// Add the line 'ProxyPreserveHost On' in the API location settings
// NEVER FORGET: Some machines are under restrictive proxies which make impossible to read this value
// In these cases the host is set to 'localhost' or 'rest' usually
// Since this may have no solution the host may be forced in the .env file
// e.g. HOST=myhost.mddbr.eu
const getHost = request => process.env.HOST || request.get('host');

// Get the request host and then get the host configuration
// Configurations are defined in the config.yml file in the root
// Note that localhost has to do some extra logic to match the configuration
// NEVER FORGET: For the host to be inherited (and not 'localhost') you need to configure your apache
// Add the line 'ProxyPreserveHost On' in the API location settings
const getConfig = request => {
    // Get the request host
    const host = getHost(request);
    // Get host configuration
    const config = hostConfig[host];
    if (config) return config;
    // When host is the localhost, the request host usually includes the port (e.g. localhost:8000)
    if (host.startsWith('localhost')) return hostConfig['localhost'];
    // If we still have no match then return a default value
    return {
        name: '(Unknown service)',
        description: 'The requesting URL is not recognized, all local collections will be returned'
    };
}

// Given the original URL, get only the base URL, before entering in any endpoint
// WARNING: Note that the URL base may change
// e.g. in local host it is /rest/... while normally it is /api/rest/...
const getBaseURL = originalURL => {
    // Use the 'rest' slot to indetify the core of the URL
    // This should always be present
    const slots = originalURL.split('/');
    const coreIndex = slots.indexOf('rest');
    // We will take the next slot as well, which corresponds to the versions
    const versionIndex = coreIndex + 1;
    // Reconstruct the URL until the version slot
    const baseURL = slots.slice(0, versionIndex + 1).join('/');
    return baseURL;
}

// Given 2 sets, return the intersection between them
// This should be done using the set intersection function, but this is not implemented in old js versions
const intersection = (set1, set2) => {
    const matches = [];
    set1.forEach(value => { if (set2.has(value)) matches.push(value) });
    return new Set(matches);
}

// Get the average from a list of values
const caluclateMean = values => {
    const addition = values.reduce((acc, curr) => acc + curr, 0);
    return addition / values.length;
}

// Get the average and standard deviation from a list of values
// https://stackoverflow.com/questions/7343890/standard-deviation-javascript
const caluclateMeanAndStandardDeviation = values => {
    const n = values.length;
    const mean = caluclateMean(values);
    const stdv = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    return { mean, stdv };
}

// Find the maximum value in a list
// Using the reduce function we can handle very large arrays, while Math.max can not
const max = array => array.reduce((cv, nv) => Math.max(cv, nv), -Infinity);

// Find the minimum value in a list
// Using the reduce function we can handle very large arrays, while Math.min can not
const min = array => array.reduce((cv, nv) => Math.min(cv, nv), Infinity);

// Round a numbers
const round2tenths = number => Math.round(number * 10) / 10;
const round2cents = number => Math.round(number * 100) / 100;

module.exports = {
    getRequestUrl,
    parseJSON,
    isObjectId,
    isIterable,
    setOutputFilename,
    getValueGetter,
    getHost,
    getConfig,
    getBaseURL,
    intersection,
    caluclateMean,
    caluclateMeanAndStandardDeviation,
    max,
    min,
    round2tenths,
    round2cents,
}