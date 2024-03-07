// Functions to be used widely along the code

const { split } = require("lodash");

// Try to parse JSON and return the bad request error in case it fails
const parseJSON = string => {
    try {
        const parse = JSON.parse(string);
        if (parse && typeof parse === 'object') return parse;
    } catch (e) {
        return false;
    }
};

// Set a function to check if an object is iterable
const isIterable = obj => {
    if (!obj) return false;
    return typeof obj[Symbol.iterator] === 'function';
};

// Set output filename
const setOutpuFilename = (projectData, descriptor, forcedFormat = null) => {
    // Set the prefix
     // Add the id or accession as prefix but replacing non filename-friendly characters
    let prefix = (projectData.accession || projectData.identifier).replace(':','_');
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

module.exports = {
    parseJSON,
    isIterable,
    setOutpuFilename
}