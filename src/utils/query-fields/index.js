// Translate the 'filter' and 'return' arguments into mongo queries and projections
// Users never send mongo code directly, so they can not inject any mongo operator
// Every filter is one or several conditions separated by ';', which are matched if any condition matches
// Every condition is a field, an operator and one or several values separated by ',' (e.g. "type=eq='ensemble','md'")
// Operators are written as words between equal signs (e.g. '=eq='), although some symbols are supported as well (e.g. '==')
// Text values must be quoted with single quotes, so they may include any character
// The syntax relies on characters which do not need to be percent encoded in URLs, so filters remain readable
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
// - multiple - The operator supports several values separated by ',', which are matched if any value matches
// - nullable - The operator supports an empty value, which stands for fields with no value
// - text - The operator matches values which contain the requested text
// - comparison - The mongo comparison operator
// - types - Field types which support this operator, if restricted
const OPERATORS = {
    '=eq=': { description: 'equals', multiple: true, nullable: true },
    '=ne=': { description: 'not equals', negated: true, multiple: true, nullable: true },
    '=ct=': { description: 'contains, case insensitive', multiple: true, text: true, types: ['string'] },
    '=nc=': { description: 'does not contain, case insensitive', negated: true, multiple: true, text: true, types: ['string'] },
    '=gt=': { description: 'greater than', comparison: '$gt', types: ['int', 'float', 'date'] },
    '=ge=': { description: 'greater than or equal', comparison: '$gte', types: ['int', 'float', 'date'] },
    '=lt=': { description: 'lower than', comparison: '$lt', types: ['int', 'float', 'date'] },
    '=le=': { description: 'lower than or equal', comparison: '$lte', types: ['int', 'float', 'date'] },
};
// Operators may be written also with symbols
const OPERATOR_ALIASES = {
    '==': '=eq=',
    '!=': '=ne=',
    '~=': '=ct=', '~': '=ct=', '≃': '=ct=',
    '!~=': '=nc=', '!~': '=nc=', '≄': '=nc=',
    '>': '=gt=', '>=': '=ge=', '<': '=lt=', '<=': '=le=',
};
// Operators are searched from the longest to the shortest, so they are not confused (e.g. '>=' and '>')
const OPERATOR_SYMBOLS = [ ...Object.keys(OPERATORS), ...Object.keys(OPERATOR_ALIASES) ]
    .sort((a, b) => b.length - a.length);
// Set the separator of several conditions in a single filter
const CONDITIONS_SEPARATOR = ';';
// Set the separator of several values in a single condition
const VALUES_SEPARATOR = ',';
// Set the character used to quote text values and the character to escape characters inside quotes
const QUOTE = "'";
const ESCAPE = '\\';
// The field ends where any of these characters is found
// Note that operator words are always preceded by an equal sign, so only their first character matters
const FIELD_END_CHARACTERS = new Set([ ...OPERATOR_SYMBOLS.map(symbol => symbol[0]), QUOTE, VALUES_SEPARATOR, CONDITIONS_SEPARATOR ]);
const isSpace = character => /\s/.test(character);
// Set the values matched by an empty value, which stands for fields with no value
// Note that null matches both missing and null fields
const NO_VALUES = [ null, [] ];

// Set a bad request error response
const badRequest = error => ({ headerError: BAD_REQUEST, error });

// Describe the operators supported by a field type, for error messages
// Only the default operator names are shown, although their symbols are supported as well
// If the type is unknown (null) then all operators are supported
const describeOperators = type => Object.entries(OPERATORS)
    .filter(([ , operator ]) => type === null || !operator.types || operator.types.includes(type))
    .map(([ symbol, operator ]) => `'${symbol}' (${operator.description})`)
    .join(', ');
// List the operators with a specific flag, for error messages
const listOperators = flag => Object.keys(OPERATORS).filter(symbol => OPERATORS[symbol][flag])
    .map(symbol => `'${symbol}'`).join(', ');

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
// Text values must be quoted while numbers, booleans and dates may be quoted or not
// If the type is unknown then quoted values are texts, while unquoted values must be booleans or numbers
// Return an error message if the value is wrong
const parseValue = ({ text, quoted }, type) => {
    const number = Number(text);
    const isNumber = text.trim() !== '' && !isNaN(number);
    if (type === 'int' || type === 'float') {
        if (!isNumber || (type === 'int' && !Number.isInteger(number)))
            return { error: `must be ${type === 'int' ? 'an integer' : 'a number'}` };
        return number;
    }
    if (type === 'boolean') {
        if (text !== 'true' && text !== 'false') return { error: `must be either true or false` };
        return text === 'true';
    }
    if (type === 'date') {
        const date = new Date(text);
        if (text.trim() === '' || isNaN(date)) return { error: 'must be a date (e.g. 2026-02-04)' };
        return date;
    }
    if (type === 'string') {
        if (!quoted) return { error: `must be quoted with single quotes (e.g. '${text}')` };
        return text;
    }
    if (type !== null) throw new Error(`Unknown query field type "${type}"`);
    if (quoted) return text;
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (isNumber) return number;
    return { error: `must be quoted with single quotes if they are text (e.g. '${text}')` };
};

// Read the values of a condition, starting at a given position of the filter
// Values are separated by ',' and the condition ends with ';' or at the end of the filter
// Quoted values may include any character, and quotes inside them may be escaped with '\'
// Empty unquoted values stand for fields with no value and they are returned as null
// Return the values and the position where the condition ends, or an error message
const readValues = (filter, start) => {
    const values = [];
    let position = start;
    while (true) {
        while (position < filter.length && isSpace(filter[position])) position++;
        const character = filter[position];
        let value;
        if (character === QUOTE) {
            // Read a quoted value
            let text = '';
            const quoteStart = position;
            position++;
            while (position < filter.length && filter[position] !== QUOTE) {
                if (filter[position] === ESCAPE) position++;
                if (position < filter.length) text += filter[position];
                position++;
            }
            if (position >= filter.length) return { error: `Unclosed quote at position ${quoteStart + 1}` };
            position++;
            while (position < filter.length && isSpace(filter[position])) position++;
            const next = filter[position];
            if (position < filter.length && next !== VALUES_SEPARATOR && next !== CONDITIONS_SEPARATOR)
                return { error: `Unexpected character '${next}' after a quoted value. ` +
                    `Values must be separated by '${VALUES_SEPARATOR}' and conditions by '${CONDITIONS_SEPARATOR}'` };
            value = { text, quoted: true };
        }
        else {
            // Read an unquoted value
            const valueStart = position;
            while (position < filter.length && filter[position] !== VALUES_SEPARATOR
                && filter[position] !== CONDITIONS_SEPARATOR) {
                if (filter[position] === QUOTE) return { error: 'Unexpected quote in an unquoted value. ' +
                    'Quotes must surround the whole value' };
                if (filter[position] === '"') return { error: 'Double quotes are not supported. ' +
                    "Text values must be quoted with single quotes (e.g. 'ensemble')" };
                position++;
            }
            const text = filter.slice(valueStart, position).trim();
            value = text === '' ? null : { text, quoted: false };
        }
        values.push(value);
        if (filter[position] !== VALUES_SEPARATOR) return { values, end: position };
        position++;
    }
};

// Parse a single condition (e.g. "uniprotOrganism=eq='Homo sapiens'") into a mongo condition
// The condition starts at a given position of the filter
// Return the field path, the condition the field value must match, if the condition is to be negated
// and the position where the condition ends
// Note that the condition is returned always in positive, so it can be applied to references collections as well
const parseCondition = (filter, start, fieldResolver) => {
    // Set a function to return errors which mention the wrong condition
    // If the end of the condition is not known yet then the condition is guessed until the next conditions separator
    const conditionError = (message, end) => {
        if (end === undefined) {
            const separatorIndex = filter.indexOf(CONDITIONS_SEPARATOR, start);
            end = separatorIndex === -1 ? filter.length : separatorIndex;
        }
        const conditionText = filter.slice(start, end).trim();
        let location = `condition "${conditionText}" of filter "${filter}"`;
        if (conditionText === filter.trim()) location = `filter "${filter}"`;
        else if (conditionText === '') location = `an empty condition of filter "${filter}"`;
        return badRequest(message.replace('$CONDITION', location));
    };
    // Read the field
    let position = start;
    while (position < filter.length && isSpace(filter[position])) position++;
    const fieldStart = position;
    while (position < filter.length && !FIELD_END_CHARACTERS.has(filter[position]) && !isSpace(filter[position])) position++;
    const fieldName = filter.slice(fieldStart, position);
    if (!fieldName) return conditionError(`Missing field in $CONDITION. ` +
        `Conditions must be a field, an operator and a value (e.g. "type=eq='ensemble'")`);
    const field = fieldResolver(fieldName);
    if (field.error) return conditionError(`Wrong $CONDITION. ${field.error}`);
    const fieldDescription = describeField(fieldName, field);
    // Find the operator
    while (position < filter.length && isSpace(filter[position])) position++;
    const symbol = OPERATOR_SYMBOLS.find(operatorSymbol => filter.startsWith(operatorSymbol, position));
    if (!symbol) return conditionError(`Missing or unknown operator in $CONDITION. ` +
        `Conditions must be a field, an operator and a value (e.g. "type=eq='ensemble'"). ` +
        `Operators supported by ${fieldDescription} are: ${describeOperators(field.type)}`);
    const operatorName = OPERATOR_ALIASES[symbol] || symbol;
    const operator = OPERATORS[operatorName];
    position += symbol.length;
    // Read the values
    const read = readValues(filter, position);
    if (read.error) return conditionError(`Wrong $CONDITION. ${read.error}`);
    const { values: rawValues, end } = read;
    // Check the operator is supported for the field type
    // If the type is unknown then we let it go
    if (operator.types && field.type !== null && !operator.types.includes(field.type))
        return conditionError(`Operator '${symbol}' in $CONDITION is not supported by ${fieldDescription}. ` +
            `Supported operators are: ${describeOperators(field.type)}`, end);
    if (!operator.multiple && rawValues.length > 1)
        return conditionError(`Operator '${symbol}' in $CONDITION does not support several values. ` +
            `Several values are supported by operators ${listOperators('multiple')} only`, end);
    // Parse the values
    // Text operators always take the value as text, even if the field type is unknown
    const valueType = operator.text ? 'string' : field.type;
    const values = [];
    for (const rawValue of rawValues) {
        // Empty values stand for fields with no value (i.e. missing, null or an empty list)
        if (rawValue === null) {
            if (!operator.nullable) return conditionError(`Missing value in $CONDITION. ` +
                `Empty values, which stand for fields with no value, are only supported by operators ${listOperators('nullable')}`, end);
            values.push(...NO_VALUES);
            continue;
        }
        const parsedValue = parseValue(rawValue, valueType);
        if (parsedValue && parsedValue.error) return conditionError(
            `Wrong value ${JSON.stringify(rawValue.text)} in $CONDITION. Values of ${fieldDescription} ${parsedValue.error}`, end);
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
    return { path: field.path, condition, negated: Boolean(operator.negated), end };
};

// Parse a single filter into a list of conditions, which are matched if any condition matches
const parseFilter = (filter, fieldResolver) => {
    if (typeof filter !== 'string') return badRequest(`Wrong filter ${JSON.stringify(filter)}. Filters must be strings`);
    const conditions = [];
    let position = 0;
    while (true) {
        const parsedCondition = parseCondition(filter, position, fieldResolver);
        if (parsedCondition.error) return parsedCondition;
        const { end, ...condition } = parsedCondition;
        conditions.push(condition);
        if (end >= filter.length) return conditions;
        // Skip the conditions separator
        position = end + 1;
    }
};

// Parse the 'filter' argument, which may be a single filter or a list of them
// Return a list of parsed filters, where every filter is a list of conditions, or an error
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

// Get the mongo query of a parsed condition
const getConditionQuery = ({ path, condition, negated }) => {
    const query = { [path]: condition };
    return negated ? { $nor: [ query ] } : query;
};

// Join the mongo queries of the conditions in a filter, which are matched if any of them matches
const joinConditionQueries = queries => queries.length === 1 ? queries[0] : { $or: queries };

// Get the mongo query of a parsed filter
const getFilterQuery = conditions => joinConditionQueries(conditions.map(getConditionQuery));

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
    getConditionQuery,
    joinConditionQueries,
    getFilterQuery,
    parseReturn,
    checkNoReferenceFields,
};
