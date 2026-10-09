// Set the node class
// A node is one of the databases federated under the global API
class Node {
    constructor (data, database) {
        // Store the current node data
        this.data = data;
        this.alias = this.data.alias;
        // Store the database handler
        this.database = database;
        // Outside production use the development API url, if any
        // Note that all nodes have the 'api_url' but only some of them have the 'api_dev_url'
        const isProduction = this.database.config.production;
        this.apiUrl = (!isProduction && this.data.api_dev_url) || this.data.api_url;
    };
}

module.exports = Node;
