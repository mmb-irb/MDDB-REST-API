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
      "type=eq='ensemble'", "type=ne='ensemble'", "name=ct='sp.ke'", "name=nc='spike'",
      'systemAtoms=gt=1', 'systemAtoms=ge=1', 'systemAtoms=lt=1', 'systemAtoms=le=1',
    ])).toEqual([
      { 'metadata.TYPE': 'ensemble' },
      { $nor: [{ 'metadata.TYPE': 'ensemble' }] },
      { 'metadata.NAME': { $regex: 'sp\\.ke', $options: 'i' } },
      { $nor: [{ 'metadata.NAME': { $regex: 'spike', $options: 'i' } }] },
      { 'metadata.SYSTATS': { $gt: 1 } },
      { 'metadata.SYSTATS': { $gte: 1 } },
      { 'metadata.SYSTATS': { $lt: 1 } },
      { 'metadata.SYSTATS': { $lte: 1 } },
    ]);
  });

  test('supports operator symbols as well', () => {
    expect(getQueries([
      "type=='ensemble'", "type!='ensemble'", "name~='spike'", "name~'spike'", "name≃'spike'",
      "name!~='spike'", "name!~'spike'", "name≄'spike'",
      'systemAtoms>1', 'systemAtoms>=1', 'systemAtoms<1', 'systemAtoms<=1',
    ])).toEqual([
      { 'metadata.TYPE': 'ensemble' },
      { $nor: [{ 'metadata.TYPE': 'ensemble' }] },
      ...Array(3).fill({ 'metadata.NAME': { $regex: 'spike', $options: 'i' } }),
      ...Array(3).fill({ $nor: [{ 'metadata.NAME': { $regex: 'spike', $options: 'i' } }] }),
      { 'metadata.SYSTATS': { $gt: 1 } },
      { 'metadata.SYSTATS': { $gte: 1 } },
      { 'metadata.SYSTATS': { $lt: 1 } },
      { 'metadata.SYSTATS': { $lte: 1 } },
    ]);
  });

  test('supports several values', () => {
    expect(getQueries(["author=eq='A','B'", "group=nc='orozco', 'irb'"])).toEqual([
      { 'metadata.AUTHORS': { $in: ['A', 'B'] } },
      { $nor: [{ 'metadata.GROUPS': { $regex: 'orozco|irb', $options: 'i' } }] },
    ]);
  });

  test('supports several conditions matched if any matches', () => {
    expect(getQueries("uniprotOrganism=eq='Homo sapiens' ; pdbOrganism=eq='Homo sapiens','Mus musculus';temperature=gt=300"))
      .toEqual([{ $or: [
        { 'references.proteins.organism': 'Homo sapiens' },
        { 'references.pdbs.organisms': { $in: ['Homo sapiens', 'Mus musculus'] } },
        { 'metadata.TEMP': { $gt: 300 } },
      ] }]);
  });

  test('takes any character inside quotes', () => {
    expect(getQueries(["name=eq='a;b,c=eq=d \"e\"'", "name=eq='it\\'s'", "name=eq='a \\\\b'", "name=eq=''"])).toEqual([
      { 'metadata.NAME': 'a;b,c=eq=d "e"' },
      { 'metadata.NAME': "it's" },
      { 'metadata.NAME': 'a \\b' },
      { 'metadata.NAME': '' },
    ]);
  });

  test('takes empty values as fields with no value', () => {
    expect(getQueries(['pdbId=eq=', 'mds=ne=', "pdbId=eq=,'6M0J'"])).toEqual([
      { 'metadata.PDBIDS': { $in: [null, []] } },
      { $nor: [{ mds: { $in: [null, []] } }] },
      { 'metadata.PDBIDS': { $in: [null, [], '6M0J'] } },
    ]);
  });

  test('parses numbers, booleans and dates either quoted or not', () => {
    expect(getQueries(['systemAtoms=gt=10', "systemAtoms=gt='10'", 'published=eq=true', "published=eq='false'",
      'created=gt=2024-01-01', "created=gt='2024-01-01'"])).toEqual([
      { 'metadata.SYSTATS': { $gt: 10 } },
      { 'metadata.SYSTATS': { $gt: 10 } },
      { published: true },
      { published: false },
      { creationDate: { $gt: new Date('2024-01-01') } },
      { creationDate: { $gt: new Date('2024-01-01') } },
    ]);
  });

  test('takes quoted values of unknown fields as texts', () => {
    expect(getQueries(['foo=eq=1', 'foo=eq=true', "foo=eq='1'", "foo=ct='1'"])).toEqual([
      { foo: 1 }, { foo: true }, { foo: '1' }, { foo: { $regex: '1', $options: 'i' } },
    ]);
  });

  test('rejects wrong filters', () => {
    for (const filter of ['systemAtoms=eq=1.5', "temperature=eq='hot'", "published=eq='yes'", "created=gt='yesterday'",
      "type=gt='a'", "systemAtoms=ct='1'", 'systemAtoms=gt=1,2', 'name=ct=', 'systemAtoms=gt=', 'type', "=eq='a'",
      "type='ensemble'", "type=xx='ensemble'", 'name~', 'type=eq=ensemble', 'type=eq="ensemble"', 'foo=eq=bar',
      'name=ct=spike', "name=eq='spike", "name=eq='a' b", "name=eq=a'b'", "name=eq='a';", "name=eq='a';type='b'",
      ";name=eq='a'"])
      getError(filter);
  });

  test('explains the problem in error messages', () => {
    expect(getError("type='ensemble'")).toBe(`Missing or unknown operator in filter "type='ensemble'". ` +
      `Conditions must be a field, an operator and a value (e.g. "type=eq='ensemble'"). ` +
      'Operators supported by field "type" (metadata.TYPE, string type) are: ' +
      "'=eq=' (equals), '=ne=' (not equals), '=ct=' (contains, case insensitive), '=nc=' (does not contain, case insensitive)");
    expect(getError("systemAtoms=ct='1'")).toBe(`Operator '=ct=' in filter "systemAtoms=ct='1'" is not supported by ` +
      'field "systemAtoms" (metadata.SYSTATS, int type). Supported operators are: ' +
      "'=eq=' (equals), '=ne=' (not equals), '=gt=' (greater than), '=ge=' (greater than or equal), " +
      "'=lt=' (lower than), '=le=' (lower than or equal)");
    expect(getError('systemAtoms=gt=abc')).toBe('Wrong value "abc" in filter "systemAtoms=gt=abc". ' +
      'Values of field "systemAtoms" (metadata.SYSTATS, int type) must be an integer');
    expect(getError("name=eq='a' ; type=eq=ensemble")).toBe('Wrong value "ensemble" in condition "type=eq=ensemble" ' +
      `of filter "name=eq='a' ; type=eq=ensemble". Values of field "type" (metadata.TYPE, string type) ` +
      "must be quoted with single quotes (e.g. 'ensemble')");
    expect(getError("name=eq='a")).toBe(`Wrong filter "name=eq='a". Unclosed quote at position 9`);
    expect(getError('$where=eq=1')).toMatch('Wrong filter "$where=eq=1". Wrong field name "$where"');
  });

  test('rejects filters which are not strings', () => {
    getError({ $ne: 'a' });
    getError(["type=eq='ensemble'", { $ne: 'a' }]);
  });

  test('resolves fields of a reference', () => {
    const fieldResolver = getReferenceFieldResolver('proteins');
    expect(getQueries(["uniprotOrganism=eq='Homo sapiens'", "references.proteins.gene=eq='ACE2'", "uniprotName=ct='spike'"],
      fieldResolver)).toEqual([
      { organism: 'Homo sapiens' }, { gene: 'ACE2' }, { name: { $regex: 'spike', $options: 'i' } },
    ]);
    expect(getError("name=eq='spike'", fieldResolver)).toMatch('Field "name" (metadata.NAME) does not belong to proteins references');
    expect(getError("organism=eq='x'", fieldResolver)).toMatch('Field "organism" (organism) does not belong to proteins references');
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
