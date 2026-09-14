// OPTIMADE Filter Language (OFL) parser
const { ObjectId } = require('mongodb');
// Parses filter strings into MongoDB query objects.
// Grammar supported:
//   expression = and_expr (OR and_expr)*
//   and_expr   = not_expr (AND not_expr)*
//   not_expr   = NOT not_expr | atom
//   atom       = '(' expression ')' | comparison
//   comparison = identifier comparator value       (normal)
//              | value comparator identifier       (reversed)
//              | identifier HAS value
//              | identifier HAS ALL value_list
//              | identifier HAS ANY value_list
//              | identifier HAS ONLY value_list
//              | identifier LENGTH comparator value
//              | identifier CONTAINS value
//              | identifier STARTS WITH value
//              | identifier ENDS WITH value
//   comparator = '=' | '!=' | '<' | '>' | '<=' | '>='
//
// fieldMap entry formats:
//   'mongoPath'         — direct field mapping
//   null                — skip (virtual, always passes; legacy)
//   { constant: val }   — constant value; comparison evaluated statically

const T = {
  STRING: 'STRING', NUMBER: 'NUMBER', IDENTIFIER: 'IDENTIFIER',
  EQ: 'EQ', NEQ: 'NEQ', LT: 'LT', GT: 'GT', LTE: 'LTE', GTE: 'GTE',
  AND: 'AND', OR: 'OR', NOT: 'NOT',
  HAS: 'HAS', ALL: 'ALL', ANY: 'ANY', ONLY: 'ONLY',
  LENGTH: 'LENGTH', CONTAINS: 'CONTAINS', STARTS: 'STARTS', ENDS: 'ENDS', WITH: 'WITH',
  LPAREN: 'LPAREN', RPAREN: 'RPAREN', COMMA: 'COMMA',
  NULL: 'NULL', TRUE_: 'TRUE_', FALSE_: 'FALSE_',
  EOF: 'EOF',
};

const KEYWORDS = {
  AND: T.AND, OR: T.OR, NOT: T.NOT,
  HAS: T.HAS, ALL: T.ALL, ANY: T.ANY, ONLY: T.ONLY,
  LENGTH: T.LENGTH, CONTAINS: T.CONTAINS, STARTS: T.STARTS, ENDS: T.ENDS, WITH: T.WITH,
  NULL: T.NULL, TRUE: T.TRUE_, FALSE: T.FALSE_,
};

function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }

    // Quoted string
    if (input[i] === '"') {
      let j = i + 1;
      let str = '';
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\') { j++; str += input[j] || ''; }
        else str += input[j];
        j++;
      }
      if (j >= input.length) throw new Error('Unterminated string literal');
      tokens.push({ type: T.STRING, value: str });
      i = j + 1;
      continue;
    }

    // Two-char operators
    if (input.startsWith('<=', i)) { tokens.push({ type: T.LTE }); i += 2; continue; }
    if (input.startsWith('>=', i)) { tokens.push({ type: T.GTE }); i += 2; continue; }
    if (input.startsWith('!=', i)) { tokens.push({ type: T.NEQ }); i += 2; continue; }

    // Single-char operators / punctuation
    const single = { '<': T.LT, '>': T.GT, '=': T.EQ, '(': T.LPAREN, ')': T.RPAREN, ',': T.COMMA };
    if (single[input[i]]) { tokens.push({ type: single[input[i]] }); i++; continue; }

    // Numbers (including negative)
    if (/[0-9]/.test(input[i]) || (input[i] === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      let j = i;
      if (input[j] === '-') j++;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: T.NUMBER, value: parseFloat(input.slice(i, j)) });
      i = j;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(input[i])) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
      const word = input.slice(i, j);
      const kw = KEYWORDS[word.toUpperCase()];
      tokens.push(kw ? { type: kw } : { type: T.IDENTIFIER, value: word });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${input[i]}' at position ${i}`);
  }

  tokens.push({ type: T.EOF });
  return tokens;
}

const REVERSE_CMP = { '=': '=', '!=': '!=', '<': '>', '>': '<', '<=': '>=', '>=': '<=' };

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }

  peek() { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }

  expect(type) {
    const t = this.consume();
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type}`);
    return t;
  }

  is(...types) { return types.includes(this.peek().type); }

  parse() {
    const expr = this.parseExpression();
    if (!this.is(T.EOF)) throw new Error(`Unexpected token: ${this.peek().type}`);
    return expr;
  }

  parseExpression() {
    let left = this.parseAndExpr();
    while (this.is(T.OR)) {
      this.consume();
      left = { op: '$or', operands: [left, this.parseAndExpr()] };
    }
    return left;
  }

  parseAndExpr() {
    let left = this.parseNotExpr();
    while (this.is(T.AND)) {
      this.consume();
      left = { op: '$and', operands: [left, this.parseNotExpr()] };
    }
    return left;
  }

  parseNotExpr() {
    if (this.is(T.NOT)) { this.consume(); return { op: '$not', operand: this.parseNotExpr() }; }
    return this.parseAtom();
  }

  parseAtom() {
    if (this.is(T.LPAREN)) {
      this.consume();
      const expr = this.parseExpression();
      this.expect(T.RPAREN);
      return expr;
    }
    return this.parseComparison();
  }

  parseComparison() {
    // Reversed comparison: "value" operator identifier  OR  number operator identifier
    if (this.is(T.STRING, T.NUMBER)) {
      const value = this.parseValue();
      const cmp = this.parseCmp();
      const attr = this.expect(T.IDENTIFIER).value;
      return { op: 'CMP', field: attr, cmp: REVERSE_CMP[cmp], value };
    }

    const attr = this.expect(T.IDENTIFIER).value;

    if (this.is(T.HAS)) {
      this.consume();
      if (this.is(T.ALL, T.ANY, T.ONLY)) {
        const mod = this.consume().type;
        return { op: `HAS_${mod}`, field: attr, values: this.parseValueList() };
      }
      return { op: 'HAS', field: attr, value: this.parseValue() };
    }

    if (this.is(T.LENGTH)) {
      this.consume();
      // Comparator is optional; LENGTH 4 is implicit equality per OPTIMADE spec
      const cmp = this.is(T.EQ, T.NEQ, T.LT, T.GT, T.LTE, T.GTE) ? this.parseCmp() : '=';
      return { op: 'LENGTH', field: attr, cmp, value: this.parseValue() };
    }

    if (this.is(T.CONTAINS)) {
      this.consume();
      return { op: 'CONTAINS', field: attr, value: this.parseValue() };
    }

    if (this.is(T.STARTS)) {
      this.consume();
      if (this.is(T.WITH)) this.consume();
      return { op: 'STARTS_WITH', field: attr, value: this.parseValue() };
    }

    if (this.is(T.ENDS)) {
      this.consume();
      if (this.is(T.WITH)) this.consume();
      return { op: 'ENDS_WITH', field: attr, value: this.parseValue() };
    }

    const cmp = this.parseCmp();
    return { op: 'CMP', field: attr, cmp, value: this.parseValue() };
  }

  parseCmp() {
    const map = { [T.EQ]: '=', [T.NEQ]: '!=', [T.LT]: '<', [T.GT]: '>', [T.LTE]: '<=', [T.GTE]: '>=' };
    const t = this.consume();
    if (!map[t.type]) throw new Error(`Expected comparator, got ${t.type}`);
    return map[t.type];
  }

  parseValue() {
    const t = this.consume();
    if (t.type === T.STRING) return { kind: 'string', v: t.value };
    if (t.type === T.NUMBER) return { kind: 'number', v: t.value };
    if (t.type === T.NULL) return { kind: 'null', v: null };
    if (t.type === T.TRUE_) return { kind: 'bool', v: true };
    if (t.type === T.FALSE_) return { kind: 'bool', v: false };
    if (t.type === T.IDENTIFIER) return { kind: 'string', v: t.value };
    throw new Error(`Expected value, got ${t.type}`);
  }

  parseValueList() {
    const values = [this.parseValue()];
    while (this.is(T.COMMA)) { this.consume(); values.push(this.parseValue()); }
    return values;
  }
}

const CMP_OPS = { '=': '$eq', '!=': '$ne', '<': '$lt', '>': '$gt', '<=': '$lte', '>=': '$gte' };

// Evaluate an OFL comparison node against a constant value (for virtual fields)
function evalConstant(constVal, ast) {
  const { op } = ast;
  if (op === 'CMP') {
    const v = ast.value.v;
    switch (ast.cmp) {
      case '=':  return constVal == v;   // eslint-disable-line eqeqeq
      case '!=': return constVal != v;   // eslint-disable-line eqeqeq
      case '<':  return constVal <  v;
      case '>':  return constVal >  v;
      case '<=': return constVal <= v;
      case '>=': return constVal >= v;
      default:   return false;
    }
  }
  if (op === 'HAS') {
    return Array.isArray(constVal) ? constVal.includes(ast.value.v) : constVal === ast.value.v;
  }
  if (op === 'HAS_ALL') {
    if (!Array.isArray(constVal)) return false;
    return ast.values.every(v => constVal.includes(v.v));
  }
  if (op === 'HAS_ANY') {
    if (!Array.isArray(constVal)) return false;
    return ast.values.some(v => constVal.includes(v.v));
  }
  if (op === 'HAS_ONLY') {
    if (!Array.isArray(constVal)) return false;
    return constVal.every(x => ast.values.some(v => v.v === x));
  }
  if (op === 'LENGTH') {
    const len = Array.isArray(constVal) ? constVal.length : 0;
    const v = ast.value.v;
    switch (ast.cmp) {
      case '=':  return len == v;   // eslint-disable-line eqeqeq
      case '!=': return len != v;   // eslint-disable-line eqeqeq
      case '<':  return len <  v;
      case '>':  return len >  v;
      case '<=': return len <= v;
      case '>=': return len >= v;
      default:   return false;
    }
  }
  return false;
}

// MongoDB filter that matches no documents
const IMPOSSIBLE = { $nor: [{}] };

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Coerce ISO date strings to Date objects for timestamp comparison
function coerceDate(rawVal) {
  if (typeof rawVal === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(rawVal)) {
    return new Date(rawVal);
  }
  return rawVal;
}

function astToMongo(ast, fieldMap) {
  if (!ast) return {};

  if (ast.op === '$and') return { $and: ast.operands.map(o => astToMongo(o, fieldMap)) };
  if (ast.op === '$or')  return { $or:  ast.operands.map(o => astToMongo(o, fieldMap)) };
  if (ast.op === '$not') return { $nor: [astToMongo(ast.operand, fieldMap)] };

  const { field, op } = ast;
  const fieldSpec = fieldMap[field];

  if (fieldSpec === undefined) {
    // Unknown provider-specific fields (start with '_') should be silently ignored
    // per OPTIMADE spec: "implementations MUST ignore unknown provider fields"
    if (field.startsWith('_')) {
      return {};
    }
    throw Object.assign(new Error(`Property '${field}' is not supported for filtering`), { status: 400 });
  }

  // Legacy null = virtual constant (skip filter entirely — returns all results)
  if (fieldSpec === null) return {};

  // Constant value field: evaluate comparison statically
  if (typeof fieldSpec === 'object' && 'constant' in fieldSpec) {
    const matches = evalConstant(fieldSpec.constant, ast);
    return matches ? {} : IMPOSSIBLE;
  }

  // Direct MongoDB field path (string)
  const mongoField = fieldSpec;
  const rawVal = ast.value ? ast.value.v : null;

  switch (op) {
    case 'CMP': {
      // ObjectId fields need proper BSON ObjectId for comparison ordering
      if (mongoField === '_id') {
        try {
          return { [mongoField]: { [CMP_OPS[ast.cmp]]: new ObjectId(String(rawVal)) } };
        } catch {
          return IMPOSSIBLE;
        }
      }
      return { [mongoField]: { [CMP_OPS[ast.cmp]]: coerceDate(rawVal) } };
    }

    case 'HAS':
      return { [mongoField]: rawVal };

    case 'HAS_ALL':
      return { [mongoField]: { $all: ast.values.map(v => v.v) } };

    case 'HAS_ANY':
      return { [mongoField]: { $in: ast.values.map(v => v.v) } };

    case 'HAS_ONLY':
      return { [mongoField]: { $not: { $elemMatch: { $nin: ast.values.map(v => v.v) } } } };

    case 'LENGTH': {
      const n = Number(ast.value.v);
      if (ast.cmp === '=') return { [mongoField]: { $size: n } };
      // For non-equality length comparisons use $expr with $size
      return { $expr: { [CMP_OPS[ast.cmp]]: [{ $size: `$${mongoField}` }, n] } };
    }

    case 'CONTAINS':
      if (mongoField === '_id') {
        return { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: escapeRegex(String(rawVal)), options: 'i' } } };
      }
      return { [mongoField]: { $regex: escapeRegex(String(rawVal)), $options: 'i' } };

    case 'STARTS_WITH':
      if (mongoField === '_id') {
        return { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `^${escapeRegex(String(rawVal))}`, options: 'i' } } };
      }
      return { [mongoField]: { $regex: `^${escapeRegex(String(rawVal))}`, $options: 'i' } };

    case 'ENDS_WITH':
      if (mongoField === '_id') {
        return { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `${escapeRegex(String(rawVal))}$`, options: 'i' } } };
      }
      return { [mongoField]: { $regex: `${escapeRegex(String(rawVal))}$`, $options: 'i' } };

    default:
      throw new Error(`Unsupported operator: ${op}`);
  }
}

// Main exported function
// fieldMap: { optimadeFieldName: 'mongodb.path' | null | { constant: value } }
// Returns a MongoDB query object, or throws an Error with .status = 400 on bad input
function parseFilter(filterStr, fieldMap) {
  if (!filterStr) return {};
  try {
    const tokens = tokenize(filterStr);
    const ast = new Parser(tokens).parse();
    return astToMongo(ast, fieldMap);
  } catch (err) {
    if (!err.status) err.status = 400;
    throw err;
  }
}

module.exports = { parseFilter };
