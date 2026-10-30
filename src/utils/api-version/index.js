// Keep track of the REST API version requested by the user along the whole request
// The version is set once by a middleware and it may be read from anywhere afterwards
// i.e. route handlers, formatters or any auxiliar function, with no need to pass the request around
const { AsyncLocalStorage } = require('node:async_hooks');

// Supported REST API versions, from oldest to newest
// To add a new version just add it at the end of this list
const API_VERSIONS = [1, 2];
// The 'current' alias always points to the newest version
const CURRENT_API_VERSION = API_VERSIONS[API_VERSIONS.length - 1];

// Get the version number from its route name (e.g. 'v1' -> 1, 'current' -> the newest)
const parseApiVersion = versionName => {
    if (versionName === 'current') return CURRENT_API_VERSION;
    const version = +versionName.replace(/^v/, '');
    if (!API_VERSIONS.includes(version))
        throw new Error(`Unsupported API version '${versionName}'`);
    return version;
};

// Route names for every supported version, including the 'current' alias
const API_VERSION_NAMES = [...API_VERSIONS.map(version => `v${version}`), 'current'];

// Storage which keeps the version of the request being handled
const apiVersionStorage = new AsyncLocalStorage();

// Set a middleware which sets the API version for the rest of the request
// Note that everything run after this middleware, sync or async, will see the same version
const apiVersionMiddleware = versionName => {
    const version = parseApiVersion(versionName);
    return (request, response, next) => {
        // Let the user know which version actually answered, which is useful for the 'current' alias
        response.set('X-API-Version', `v${version}`);
        apiVersionStorage.run(version, next);
    };
};

// Get the API version of the request being handled as a number
// Compare it like 'if (getApiVersion() >= 2)'
const getApiVersion = () => {
    const version = apiVersionStorage.getStore();
    if (version === undefined)
        throw new Error('API version is not set. Is this code running outside a versioned REST route?');
    return version;
};

module.exports = {
    API_VERSIONS,
    API_VERSION_NAMES,
    CURRENT_API_VERSION,
    apiVersionMiddleware,
    getApiVersion,
};
