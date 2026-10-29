const { rangedSelectionParser } = require('.');
const { BAD_REQUEST } = require('../status-codes');

// Set a limit for all tests, as if the system had 10 atoms
const parse = selection => rangedSelectionParser(selection, 10, 'atom');

describe('rangedSelectionParser', () => {
  test('single indices and ranges', () => {
    expect(parse('1, 3, 5-8')).toEqual([1, 3, 5, 6, 7, 8]);
    expect(parse('1,2 , 3')).toEqual([1, 2, 3]);
    expect(parse(' 1 ,2 ')).toEqual([1, 2]);
    expect(parse('0-9')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('long runs of spaces are handled quickly', () => {
    // Splitting with a regular expression such as /\s*,\s*/ took seconds here
    const spaces = ' '.repeat(1000000);
    expect(parse(`1${spaces}a`)).toContainEqual(NaN);
    expect(parse(`1${spaces},${spaces}2`)).toEqual([1, 2]);
  });

  test('indices are sorted and unique', () => {
    expect(parse('7, 2-4, 3, 2')).toEqual([2, 3, 4, 7]);
  });

  test('reversed ranges select nothing', () => {
    expect(parse('5-2')).toEqual([]);
    expect(parse('99-2')).toEqual([]);
  });

  test('indices and ranges beyond the limit', () => {
    for (const selection of ['10', '3, 15', '5-10', '20-30', '0-99999999999', '99999999999'])
      expect(parse(selection).headerError).toBe(BAD_REQUEST);
    expect(parse('5-10').error).toMatch('There are 10 atoms');
  });

  test('wrong units are kept as NaN, so they are rejected further', () => {
    for (const selection of ['a', '-1', '1.5', '', '1,,2', '1-a'])
      expect(parse(selection)).toContainEqual(NaN);
  });

  test('repeated ranges never select more indices than the limit', () => {
    const limit = 1000000;
    const repeated = Array(10000).fill(`0-${limit - 1}`).join(',');
    expect(rangedSelectionParser(repeated, limit, 'atom')).toHaveLength(limit);
  });

  test('missing limit', () => {
    expect(() => rangedSelectionParser('0-9')).toThrow();
  });
});
