// Functions to be used widely along the code

// Try to parse JSON and return the bad request error in case it fails
const parseJSON = string => {
    try {
        const parse = JSON.parse(string);
        if (parse && typeof parse === 'object') return parse;
    } catch (e) {
        return false;
    }
};

module.exports = {
    parseJSON
}