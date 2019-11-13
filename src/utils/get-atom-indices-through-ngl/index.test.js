const getAtomIndices = require('.');
const { readFileSync } = require('fs');

describe('getAtomIndices', () => {
  const testExample = readFileSync(`${__dirname}/test.pdb`);
  test('no selection', async () => {
    jest.setTimeout(15000);
    expect(await getAtomIndices(testExample, '')).toBe(
      '0-0,1-1,2-2,3-3,4-4,5-5,6-6,7-7',
    );
  });
  test('backbone selection', async () => {
    jest.setTimeout(15000);
    expect(await getAtomIndices(testExample, 'backbone')).toBe('0-0,1-1,7-7');
  });
  test('all carbons selection', async () => {
    jest.setTimeout(15000);
    expect(await getAtomIndices(testExample, '_C')).toBe(
      '1-1,2-2,3-3,4-4,5-5,7-7',
    );
  });
  test('all single carbons selection', async () => {
    jest.setTimeout(15000);
    expect(await getAtomIndices(testExample, '.C')).toBe('7-7');
  });
  test('combined selections', async () => {
    jest.setTimeout(15000);
    expect(await getAtomIndices(testExample, 'backbone and _C')).toBe(
      '1-1,7-7',
    );
  });
});
