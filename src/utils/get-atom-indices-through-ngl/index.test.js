const getAtomIndices = require('.');
const { readFileSync } = require('fs');

jest.setTimeout(15000);

describe('getAtomIndices', () => {
  const testExample = readFileSync(`${__dirname}/test.pdb`);

  test('no selection', async () => {
    expect(await getAtomIndices(testExample, '')).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('backbone selection', async () => {
    expect(await getAtomIndices(testExample, 'backbone')).toEqual([0, 1, 7]);
  });

  test('all carbons selection', async () => {
    expect(await getAtomIndices(testExample, '_C')).toEqual([1, 2, 3, 4, 5, 7]);
  });

  test('all single carbons selection', async () => {
    expect(await getAtomIndices(testExample, '.C')).toEqual([7]);
  });

  test('combined selections', async () => {
    expect(await getAtomIndices(testExample, 'backbone and _C')).toEqual([1, 7]);
  });
});
