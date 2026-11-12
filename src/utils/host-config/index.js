// Load the host configuration, which sets the behaviour of the API depending on the requesting host
// It is read from the config.yml file at the repository root, which is ignored by git so every node has its own one
// If there is no config.yml then the default configuration is used for every host
// See example-single-config.yml and example-multiple-config.yml at the repository root for the file format
const fs = require('fs');
const path = require('path');
// Library to read yaml files
const yaml = require('yamljs');

const CONFIG_PATH = path.resolve(__dirname, '../../../config.yml');

// Fields a host configuration may have
// name - Service name to be displayed in the swagger docs
// description - Header description to be displayed in the swagger docs
// accession - Accession example to be displayed in the swagger docs
// collection - Specific collection to be targeted. Other collections will be filtered away
// global - Set if it is to behave as global API instead of a local (federated) API
// production - Set if projects with 'published: false' are to be hidden (true) or shown (false)
// hostfix - Host to be displayed in the swagger docs instead of the requesting one
// optimade - Set if the OPTIMADE API is to be mentioned in the swagger docs
// Missing fields are filled with these default values
const DEFAULT_CONFIG = {
    name: 'MDposit',
    description: 'MDDB federated node server',
    accession: 'A0001',
    collection: undefined,
    global: false,
    production: false,
    hostfix: undefined,
    optimade: true,
};
const CONFIG_FIELDS = Object.keys(DEFAULT_CONFIG);

// Complete a host configuration with the default values
// Unknown fields are not accepted, so typos do not silently fall back to the default values
const processConfig = (config, label) => {
    if (config === null || typeof config !== 'object' || Array.isArray(config))
        throw new Error(`Host configuration of ${label} in ${CONFIG_PATH} must be a set of fields`);
    const unknownFields = Object.keys(config).filter(field => !CONFIG_FIELDS.includes(field));
    if (unknownFields.length > 0) throw new Error(`Unknown fields in the host configuration of ${label} in ${CONFIG_PATH}: `
        + `${unknownFields.join(', ')}. Supported fields are: ${CONFIG_FIELDS.join(', ')}`);
    return { ...DEFAULT_CONFIG, ...config };
};

// Read the configuration file
// It may have the configuration of several hosts under the 'hosts' field, with each host name as key
// Otherwise the whole file is a single configuration to be used for every host
const loadConfig = () => {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.log('No config.yml found: using the default host configuration');
        return { hostConfig: {}, unknownHostConfig: processConfig({}, 'the default') };
    }
    const content = yaml.load(CONFIG_PATH);
    // An empty file is the same as no file
    if (content === null) return { hostConfig: {}, unknownHostConfig: processConfig({}, 'the default') };
    // Single configuration
    if (!('hosts' in content)) return { hostConfig: {}, unknownHostConfig: processConfig(content, 'every host') };
    // Multiple configurations
    const otherFields = Object.keys(content).filter(field => field !== 'hosts');
    if (otherFields.length > 0) throw new Error(`Fields ${otherFields.join(', ')} in ${CONFIG_PATH} are not allowed `
        + `together with 'hosts': host fields go inside each host`);
    const hostConfig = {};
    Object.entries(content.hosts).forEach(([host, config]) => {
        hostConfig[host] = processConfig(config, host);
    });
    // Requests from not configured hosts get the default configuration, but tell they are not recognized
    const unknownHostConfig = processConfig({
        name: '(Unknown service)',
        description: 'The requesting URL is not recognized, all local collections will be returned',
    }, 'unknown hosts');
    return { hostConfig, unknownHostConfig };
};

// hostConfig - Configuration of every configured host, with the host name as key
// unknownHostConfig - Configuration for any other host
const { hostConfig, unknownHostConfig } = loadConfig();

// Get the configuration of a host
// Note that localhost requests usually include the port (e.g. localhost:8000)
const getHostConfig = host => {
    if (host in hostConfig) return hostConfig[host];
    if (host.startsWith('localhost') && 'localhost' in hostConfig) return hostConfig['localhost'];
    return unknownHostConfig;
};

module.exports = { hostConfig, unknownHostConfig, getHostConfig };
