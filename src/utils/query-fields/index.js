// Translate the 'filter' and 'return' arguments into mongo queries and projections
// Users never send mongo code directly, so they can not inject any mongo operator
// Fields may be requested by their alias (e.g. 'uniprotOrganism') or by their full path (e.g. 'references.proteins.organism')
// Aliases are unique and they stand for the same field in every endpoint
// Query fields, including their aliases and types, are defined in the database constants
const { PATH_QUERY_FIELDS, ALIAS_QUERY_FIELDS } = require('mddb-database/utils/constants');
// Set the header of fields which are not in the project but in a references collection
const { REFERENCE_HEADER } = require('../constants');
// Get auxiliar functions
const { escapeRegExp } = require('../auxiliar-functions');
// Standard HTTP response status codes
const { BAD_REQUEST } = require('../status-codes');

// Field paths may only include alphanumeric characters and underscores, separated by dots
// Thus mongo operators (e.g. '$where') can never be passed as fields
const FIELD_PATTERN = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

// Set the supported filter operators
// - description - Shown in error messages
// - negated - The operator is the negation of another operator
// - multiple - The operator supports several values separated by '|', which are matched if any value matches
// - nullable - The operator supports an empty value, which stands for fields with no value
// - text - The operator matches values which contain the requested text
// - comparison - The mongo comparison operator
// - types - Field types which support this operator, if restricted
const OPERATORS = {
    '==': { description: 'equals', multiple: true, nullable: true },
    '!=': { description: 'not equals', negated: true, multiple: true, nullable: true },
    '~=': { description: 'contains, case insensitive', multiple: true, text: true, types: ['string'] },
    '!~=': { description: 'does not contain, case insensitive', negated: true, multiple: true, text: true, types: ['string'] },
    '>': { description: 'greater than', comparison: '$gt', types: ['int', 'float', 'date'] },
    '>=': { description: 'greater than or equal', comparison: '$gte', types: ['int', 'float', 'date'] },
    '<': { description: 'lower than', comparison: '$lt', types: ['int', 'float', 'date'] },
    '<=': { description: 'lower than or equal', comparison: '$lte', types: ['int', 'float', 'date'] },
};
// Some operators may be written also with a single symbol
const OPERATOR_ALIASES = { '~': '~=', '≃': '~=', '!~': '!~=', '≄': '!~=' };
// Operators are searched from the longest to the shortest, so they are not confused (e.g. '>=' and '>')
const OPERATOR_SYMBOLS = [ ...Object.keys(OPERATORS), ...Object.keys(OPERATOR_ALIASES) ]
    .sort((a, b) => b.length - a.length);
// The field ends where the first operator character is found
const OPERATOR_CHARACTERS = new Set(OPERATOR_SYMBOLS.join(''));
// Set the separator of several values in a single filter
const VALUES_SEPARATOR = '|';
// Set the values matched by an empty value, which stands for fields with no value
// Note that null matches both missing and null fields
const NO_VALUES = [ null, [] ];

// Set a bad request error response
const badRequest = error => ({ headerError: BAD_REQUEST, error });

// Describe the operators supported by a field type, for error messages
// If the type is unknown (null) then all operators are supported
const describeOperators = type => Object.entries(OPERATORS)
    .filter(([ , operator ]) => type === null || !operator.types || operator.types.includes(type))
    .map(([ symbol, operator ]) => `'${symbol}' (${operator.description})`)
    .join(', ');
const ALIASES_DESCRIPTION = Object.keys(OPERATORS)
    .map(symbol => [ symbol, Object.keys(OPERATOR_ALIASES).filter(alias => OPERATOR_ALIASES[alias] === symbol) ])
    .filter(([ , aliases ]) => aliases.length > 0)
    .map(([ symbol, aliases ]) => `${aliases.map(alias => `'${alias}'`).join(' or ')} may be used instead of '${symbol}'`)
    .join(' and ');

// Describe a field, for error messages
const describeField = (name, field) => {
    const typeDescription = field.type === null ? 'unknown type' : `${field.type} type`;
    const pathDescription = field.path === name ? '' : `${field.path}, `;
    return `field "${name}" (${pathDescription}${typeDescription})`;
};

// Find the path and the type of a field given its alias or its path
// Fields which are not among the query fields are supported as well, but their type is unknown (null)
const resolveField = name => {
    const queryField = ALIAS_QUERY_FIELDS[name] || PATH_QUERY_FIELDS[name];
    if (queryField) return { path: queryField.path, type: queryField.type };
    if (!FIELD_PATTERN.test(name)) return badRequest(`Wrong field name "${name}". ` +
        'Fields must be an alias or a path with only alphanumeric characters and underscores separated by dots');
    return { path: name, type: null };
};

// Set a field resolver for the fields of a specific references collection (e.g. 'proteins')
// Fields are resolved as anywhere else, but they must belong to this reference
// Then their path is made relative to the reference document (e.g. 'references.proteins.name' -> 'name')
const getReferenceFieldResolver = referenceName => {
    const referenceHeader = `${REFERENCE_HEADER}${referenceName}.`;
    const referenceAliases = Object.values(ALIAS_QUERY_FIELDS)
        .filter(queryField => queryField.path.startsWith(referenceHeader))
        .map(queryField => `'${queryField.alias}'`);
    return name => {
        const field = resolveField(name);
        if (field.error) return field;
        if (!field.path.startsWith(referenceHeader)) return badRequest(
            `Field "${name}" (${field.path}) does not belong to ${referenceName} references. ` +
            `Use a path starting with '${referenceHeader}'` +
            (referenceAliases.length > 0 ? ` or any of these aliases: ${referenceAliases.join(', ')}` : ''));
        return { path: field.path.slice(referenceHeader.length), type: field.type };
    };
};

// Parse a filter value according to the field type
// If the type is unknown then booleans and numbers are guessed
// Return an error message if the value is wrong
const parseValue = (value, type) => {
    const number = Number(value);
    const isNumber = value !== '' && !isNaN(number);
    if (type === 'int' || type === 'float') {
        if (!isNumber || (type === 'int' && !Number.isInteger(number)))
            return { error: `must be ${type === 'int' ? 'an integer' : 'a number'}` };
        return number;
    }
    if (type === 'boolean') {
        if (value !== 'true' && value !== 'false') return { error: `must be either 'true' or 'false'` };
        return value === 'true';
    }
    if (type === 'date') {
        const date = new Date(value);
        if (isNaN(date)) return { error: 'must be a date (e.g. 2026-02-04)' };
        return date;
    }
    if (type === 'string') return value;
    if (type !== null) throw new Error(`Unknown query field type "${type}"`);
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (isNumber) return number;
    return value;
};

// Parse a single filter (e.g. 'organism==Homo sapiens') into a mongo condition
// Return the field path, the condition the field value must match and if the condition is to be negated
// Note that the condition is returned always in positive, so it can be applied to references collections as well
const parseFilter = (filter, fieldResolver) => {
    if (typeof filter !== 'string') return badRequest(`Wrong filter ${JSON.stringify(filter)}. Filters must be strings`);
    // Split the field and the rest of the filter
    const fieldLength = [ ...filter ].findIndex(character => OPERATOR_CHARACTERS.has(character));
    const fieldName = (fieldLength === -1 ? filter : filter.slice(0, fieldLength)).trim();
    const rest = fieldLength === -1 ? '' : filter.slice(fieldLength);
    if (!fieldName) return badRequest(`Missing field in filter "${filter}". ` +
        'Filters must be a field, an operator and a value (e.g. "type==ensemble")');
    const field = fieldResolver(fieldName);
    if (field.error) return { ...field, error: `Wrong filter "${filter}". ${field.error}` };
    const fieldDescription = describeField(fieldName, field);
    // Find the operator
    const symbol = OPERATOR_SYMBOLS.find(operatorSymbol => rest.startsWith(operatorSymbol));
    if (!symbol) return badRequest(`Missing or unknown operator in filter "${filter}". ` +
        `Filters must be a field, an operator and a value (e.g. "type==ensemble"). ` +
        `Operators supported by ${fieldDescription} are: ${describeOperators(field.type)}. ${ALIASES_DESCRIPTION}`);
    const operatorName = OPERATOR_ALIASES[symbol] || symbol;
    const operator = OPERATORS[operatorName];
    // Check the operator is supported for the field type
    // If the type is unknown then we let it go
    if (operator.types && field.type !== null && !operator.types.includes(field.type))
        return badRequest(`Operator '${symbol}' in filter "${filter}" is not supported by ${fieldDescription}. ` +
            `Supported operators are: ${describeOperators(field.type)}`);
    // Parse the value or values
    // Text operators always take the value as text, even if the field type is unknown
    const valueType = operator.text ? 'string' : field.type;
    const rawValue = rest.slice(symbol.length);
    const rawValues = operator.multiple ? rawValue.split(VALUES_SEPARATOR) : [rawValue];
    const values = [];
    for (const value of rawValues.map(rawValue => rawValue.trim())) {
        // Empty values stand for fields with no value (i.e. missing, null or an empty list)
        if (value === '') {
            if (!operator.nullable) return badRequest(`Missing value in filter "${filter}". ` +
                `Empty values, which stand for fields with no value, are only supported by operators '==' and '!='`);
            values.push(...NO_VALUES);
            continue;
        }
        const parsedValue = parseValue(value, valueType);
        if (parsedValue && parsedValue.error) return badRequest(
            `Wrong value "${value}" in filter "${filter}". Values of ${fieldDescription} ${parsedValue.error}`);
        values.push(parsedValue);
    }
    // Set the mongo condition
    let condition;
    if (operator.comparison) condition = { [operator.comparison]: values[0] };
    // Match values which contain the requested text, case insensitive
    // Note that regular expressions are passed as strings, so the condition can be stringified (e.g. cache keys)
    else if (operator.text) {
        const pattern = values.map(escapeRegExp).join('|');
        condition = { $regex: pattern, $options: 'i' };
    }
    else condition = values.length === 1 ? values[0] : { $in: values };
    return { path: field.path, condition, negated: Boolean(operator.negated) };
};

// Parse the 'filter' argument, which may be a single filter or a list of them
// Return a list of parsed filters, or an error
const parseFilters = (filters, fieldResolver = resolveField) => {
    if (filters === undefined) return [];
    const filtersList = Array.isArray(filters) ? filters : [filters];
    const parsedFilters = [];
    for (const filter of filtersList) {
        const parsedFilter = parseFilter(filter, fieldResolver);
        if (parsedFilter.error) return parsedFilter;
        parsedFilters.push(parsedFilter);
    }
    return parsedFilters;
};

// Get the mongo query of a parsed filter
const getFilterQuery = ({ path, condition, negated }) => {
    const query = { [path]: condition };
    return negated ? { $nor: [ query ] } : query;
};

// Parse the 'return' argument into a list of field paths
// It may be a single string or a list of strings, and every string may include several fields separated by commas
// Return a list of field paths, or an error
const parseReturn = (returned, fieldResolver = resolveField) => {
    if (returned === undefined) return [];
    const returnedList = Array.isArray(returned) ? returned : [returned];
    const paths = [];
    for (const value of returnedList) {
        if (typeof value !== 'string') return badRequest(`Wrong return ${JSON.stringify(value)}. Returned fields must be strings`);
        const names = value.split(',').map(name => name.trim()).filter(name => name);
        for (const name of names) {
            const field = fieldResolver(name);
            if (field.error) return { ...field, error: `Wrong returned field "${name}". ${field.error}` };
            if (!paths.includes(field.path)) paths.push(field.path);
        }
    }
    // Mongo refuses projections where a field is inside another field (e.g. 'metadata' and 'metadata.NAME')
    for (const path of paths) {
        const parentPath = paths.find(other => path.startsWith(other + '.'));
        if (parentPath) return badRequest(`Returned field "${path}" is already included in "${parentPath}"`);
    }
    return paths;
};

// Make sure none of the fields belongs to a references collection
// These fields can not be returned from projects
const checkNoReferenceFields = paths => {
    const referencePath = paths.find(path => path.startsWith(REFERENCE_HEADER));
    if (referencePath) return badRequest(`Field "${referencePath}" belongs to references and it can not be returned here`);
    return null;
};

module.exports = {
    resolveField,
    getReferenceFieldResolver,
    parseFilters,
    getFilterQuery,
    parseReturn,
    checkNoReferenceFields,
};
