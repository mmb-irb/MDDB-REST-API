// Load the host configuration, which sets the behaviour of the API depending on the requesting host
// It is read from the config.yml file at the repository root, which is ignored by git so every node has its own one
// See example-config.yml at the repository root for the file format
// The file is mandatory and its format is strict: any problem stops the API when it starts
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

const isMapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Complete a host configuration with the default values
// Unknown fields are not accepted, so typos do not silently fall back to the default values
const processConfig = (config, host) => {
    if (!isMapping(config)) throw new Error(`Host configuration of ${host} in ${CONFIG_PATH} must be a set of fields`);
    const unknownFields = Object.keys(config).filter(field => !CONFIG_FIELDS.includes(field));
    if (unknownFields.length > 0) throw new Error(`Unknown fields in the host configuration of ${host} in ${CONFIG_PATH}: `
        + `${unknownFields.join(', ')}. Supported fields are: ${CONFIG_FIELDS.join(', ')}`);
    return { ...DEFAULT_CONFIG, ...config };
};

// Read the configuration file
// Root keys are the host names and each one has its own configuration inside
// To make every request use the same configuration, no matter the host it arrives with (e.g. behind a proxy),
// configure one single host and force it with the HOST variable in the .env file
const loadConfig = () => {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error(`Missing host configuration file ${CONFIG_PATH}. `
        + 'Create it with one configuration per host name (see example-config.yml)');
    const content = yaml.load(CONFIG_PATH);
    if (!isMapping(content)) throw new Error(`Host configuration file ${CONFIG_PATH} must be a set of host names, `
        + 'each one with its own configuration (see example-config.yml)');
    const hosts = Object.keys(content);
    if (hosts.length === 0) throw new Error(`Host configuration file ${CONFIG_PATH} has no hosts`);
    // Configuration fields at the root are the old single configuration format, which is no longer supported
    const rootFields = hosts.filter(host => CONFIG_FIELDS.includes(host));
    if (rootFields.length > 0) throw new Error(`Host configuration file ${CONFIG_PATH} has configuration fields at the root `
        + `(${rootFields.join(', ')}): root keys must be host names, each one with its own configuration inside `
        + '(see example-config.yml). To use one configuration for every request force the host with HOST in the .env file');
    // The old 'hosts' wrapper is no longer supported either
    if ('hosts' in content) throw new Error(`Host configuration file ${CONFIG_PATH} has a 'hosts' field: `
        + 'host names go directly at the root now (see example-config.yml)');
    const hostConfig = {};
    hosts.forEach(host => {
        hostConfig[host] = processConfig(content[host], host);
    });
    return hostConfig;
};

// Configuration of every configured host, with the host name as key
const hostConfig = loadConfig();

// The HOST forced in the .env file must be configured, otherwise every request would be unknown
const forcedHost = process.env.HOST;
if (forcedHost && !(forcedHost in hostConfig)) throw new Error(`The forced host ${forcedHost} (HOST in .env) `
    + `is not configured in ${CONFIG_PATH}. Configured hosts: ${Object.keys(hostConfig).join(', ')}`);

// Requests from not configured hosts get the default configuration, but tell they are not recognized
const unknownHostConfig = processConfig({
    name: '(Unknown service)',
    description: 'The requesting URL is not recognized, all local collections will be returned',
}, 'unknown hosts');

// Get the configuration of a host
// Note that localhost requests usually include the port (e.g. localhost:8000)
const getHostConfig = host => {
    if (host in hostConfig) return hostConfig[host];
    if (host.startsWith('localhost') && 'localhost' in hostConfig) return hostConfig['localhost'];
    return unknownHostConfig;
};

module.exports = { hostConfig, unknownHostConfig, getHostConfig };
