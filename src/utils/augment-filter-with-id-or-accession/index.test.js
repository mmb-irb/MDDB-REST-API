const { ObjectId } = require('mongodb');

const augmentFilterWithIDOrAccession = require('.');

describe('augmentFilterWithIDOrAccession', () => {
  const accession = 'accession';
  const id = ObjectId('5dada465a1f486584ed0a94e');
  it('should detect an accession', () => {
    expect(augmentFilterWithIDOrAccession({}, accession)).toEqual({
      accession,
    });
    expect(
      augmentFilterWithIDOrAccession({ somethingElse: true }, accession),
    ).toEqual({ somethingElse: true, accession });
  });

  it('should detect an id', () => {
    expect(augmentFilterWithIDOrAccession({}, id)).toEqual({
      _id: id,
    });
    expect(augmentFilterWithIDOrAccession({}, id.toString())).toEqual({
      _id: id,
    });
    expect(
      augmentFilterWithIDOrAccession({ somethingElse: true }, id.toString()),
    ).toEqual({ somethingElse: true, _id: id });
  });
});
