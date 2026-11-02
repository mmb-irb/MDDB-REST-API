const {
  resolveField,
  getReferenceFieldResolver,
  parseFilters,
  getFilterQuery,
  parseReturn,
  checkNoReferenceFields,
} = require('.');
const { BAD_REQUEST } = require('../status-codes');

// Parse filters and return their mongo queries, or the error
const getQueries = (filter, fieldResolver) => {
  const parsedFilters = parseFilters(filter, fieldResolver);
  return parsedFilters.error ? parsedFilters : parsedFilters.map(getFilterQuery);
};

// Parse a filter which is expected to be wrong and return the error message
const getError = (filter, fieldResolver) => {
  const parsedFilters = parseFilters(filter, fieldResolver);
  expect(parsedFilters.headerError).toBe(BAD_REQUEST);
  return parsedFilters.error;
};

describe('resolveField', () => {
  test('resolves aliases and paths of query fields', () => {
    expect(resolveField('uniprotOrganism')).toEqual({ path: 'references.proteins.organism', type: 'string' });
    expect(resolveField('references.proteins.organism')).toEqual({ path: 'references.proteins.organism', type: 'string' });
  });

  test('supports other fields with an unknown type', () => {
    expect(resolveField('accession')).toEqual({ path: 'accession', type: null });
  });

  test('rejects field names which are not plain paths', () => {
    for (const name of ['$where', 'metadata.$ne', 'a..b', '.a', 'a b'])
      expect(resolveField(name).headerError).toBe(BAD_REQUEST);
  });
});

describe('parseFilters', () => {
  test('supports every operator', () => {
    expect(getQueries([
      'type==ensemble', 'type!=ensemble', 'name~=sp.ke', 'name~spike', 'name≃spike', 'name!~=spike', 'name!~spike', 'name≄spike',
      'systemAtoms>1', 'systemAtoms>=1', 'systemAtoms<1', 'systemAtoms<=1',
    ])).toEqual([
      { 'metadata.TYPE': 'ensemble' },
      { $nor: [{ 'metadata.TYPE': 'ensemble' }] },
      { 'metadata.NAME': { $regex: 'sp\\.ke', $options: 'i' } },
      { 'metadata.NAME': { $regex: 'spike', $options: 'i' } },
      { 'metadata.NAME': { $regex: 'spike', $options: 'i' } },
      { $nor: [{ 'metadata.NAME': { $regex: 'spike', $options: 'i' } }] },
      { $nor: [{ 'metadata.NAME': { $regex: 'spike', $options: 'i' } }] },
      { $nor: [{ 'metadata.NAME': { $regex: 'spike', $options: 'i' } }] },
      { 'metadata.SYSTATS': { $gt: 1 } },
      { 'metadata.SYSTATS': { $gte: 1 } },
      { 'metadata.SYSTATS': { $lt: 1 } },
      { 'metadata.SYSTATS': { $lte: 1 } },
    ]);
  });

  test('supports several values', () => {
    expect(getQueries(['author==A|B', 'group!~=orozco|irb'])).toEqual([
      { 'metadata.AUTHORS': { $in: ['A', 'B'] } },
      { $nor: [{ 'metadata.GROUPS': { $regex: 'orozco|irb', $options: 'i' } }] },
    ]);
  });

  test('takes empty values as fields with no value', () => {
    expect(getQueries(['pdbId==', 'mds!=', 'pdbId==|6M0J'])).toEqual([
      { 'metadata.PDBIDS': { $in: [null, []] } },
      { $nor: [{ mds: { $in: [null, []] } }] },
      { 'metadata.PDBIDS': { $in: [null, [], '6M0J'] } },
    ]);
  });

  test('keeps operator characters in the value', () => {
    expect(getQueries('name==a=b>c')).toEqual([{ 'metadata.NAME': 'a=b>c' }]);
  });

  test('guesses the value type of unknown fields, but not in text operators', () => {
    expect(getQueries(['foo==1', 'foo==true', 'foo==bar', 'foo~=1'])).toEqual([
      { foo: 1 }, { foo: true }, { foo: 'bar' }, { foo: { $regex: '1', $options: 'i' } },
    ]);
  });

  test('rejects wrong filters', () => {
    for (const filter of ['systemAtoms==1.5', 'temperature==hot', 'published==yes', 'created>yesterday',
      'type>a', 'systemAtoms~=1', 'systemAtoms>1|2', 'name~=', 'systemAtoms>', 'type', '==a',
      'type=ensemble', 'name~'])
      getError(filter);
  });

  test('explains the problem in error messages', () => {
    expect(getError('type=ensemble')).toBe('Missing or unknown operator in filter "type=ensemble". ' +
      'Filters must be a field, an operator and a value (e.g. "type==ensemble"). ' +
      'Operators supported by field "type" (metadata.TYPE, string type) are: ' +
      "'==' (equals), '!=' (not equals), '~=' (contains, case insensitive), '!~=' (does not contain, case insensitive). " +
      "'~' or '≃' may be used instead of '~=' and '!~' or '≄' may be used instead of '!~='");
    expect(getError('systemAtoms~=1')).toBe(`Operator '~=' in filter "systemAtoms~=1" is not supported by ` +
      'field "systemAtoms" (metadata.SYSTATS, int type). Supported operators are: ' +
      "'==' (equals), '!=' (not equals), '>' (greater than), '>=' (greater than or equal), " +
      "'<' (lower than), '<=' (lower than or equal)");
    expect(getError('systemAtoms>abc')).toBe('Wrong value "abc" in filter "systemAtoms>abc". ' +
      'Values of field "systemAtoms" (metadata.SYSTATS, int type) must be an integer');
    expect(getError('$where==1')).toMatch('Wrong filter "$where==1". Wrong field name "$where"');
  });

  test('rejects filters which are not strings', () => {
    getError({ $ne: 'a' });
    getError(['type==ensemble', { $ne: 'a' }]);
  });

  test('resolves fields of a reference', () => {
    const fieldResolver = getReferenceFieldResolver('proteins');
    expect(getQueries(['uniprotOrganism==Homo sapiens', 'references.proteins.gene==ACE2', 'uniprotName~=spike'],
      fieldResolver)).toEqual([
      { organism: 'Homo sapiens' }, { gene: 'ACE2' }, { name: { $regex: 'spike', $options: 'i' } },
    ]);
    expect(getError('name==spike', fieldResolver)).toMatch('Field "name" (metadata.NAME) does not belong to proteins references');
    expect(getError('organism==x', fieldResolver)).toMatch('Field "organism" (organism) does not belong to proteins references');
  });
});

describe('parseReturn', () => {
  test('supports aliases, paths, commas and lists', () => {
    expect(parseReturn(['name,author', 'mds.frames', 'name'])).toEqual(['metadata.NAME', 'metadata.AUTHORS', 'mds.frames']);
    expect(parseReturn(undefined)).toEqual([]);
  });

  test('rejects wrong fields and colliding fields', () => {
    expect(parseReturn('$where').headerError).toBe(BAD_REQUEST);
    expect(parseReturn({ a: '1' }).headerError).toBe(BAD_REQUEST);
    expect(parseReturn('metadata,name').headerError).toBe(BAD_REQUEST);
  });

  test('detects reference fields', () => {
    expect(checkNoReferenceFields(parseReturn('name'))).toBe(null);
    expect(checkNoReferenceFields(parseReturn('uniprotOrganism')).headerError).toBe(BAD_REQUEST);
  });
});
