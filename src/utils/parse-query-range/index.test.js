const { parseQueryRange, rangeIndices, rangeNotation } = require('.');
const { BAD_REQUEST } = require('../status-codes');

// Set a limit and a dimension name for all tests
const parse = string => parseQueryRange(string, 10, 'frames');

describe('parseQueryRange', () => {
  describe('edge cases', () => {
    test('nonsense input', () => {
      for (const string of ['nonsense', '0,lkjsadjk,5', '0-1,5,lkjsadjk,7']) {
        expect(parse(string).headerError).toBe(BAD_REQUEST);
      }
    });

    test('too many numbers in step format', () => {
      expect(parse('1:10:2:4').headerError).toBe(BAD_REQUEST);
    });

    test('step format, but start at 0', () => {
      expect(parse('0:10:2').headerError).toBe(BAD_REQUEST);
    });

    test('case 0', () => {
      expect(parse('0').headerError).toBe(BAD_REQUEST);
    });

    test('contains 0', () => {
      expect(parse('0,5').headerError).toBe(BAD_REQUEST);
      expect(parse('5,0').headerError).toBe(BAD_REQUEST);
    });

    test('beyond the limit', () => {
      expect(parse('11').headerError).toBe(BAD_REQUEST);
      expect(parse('5,11').headerError).toBe(BAD_REQUEST);
      expect(parse('1-11').headerError).toBe(BAD_REQUEST);
      expect(parse('1:11').headerError).toBe(BAD_REQUEST);
      expect(parse('1:11:2').headerError).toBe(BAD_REQUEST);
    });

    test('far beyond the limit, so it would run out of memory if expanded', () => {
      for (const string of ['99999999999', '1-99999999999', '1:99999999999', '1:99999999999:2', '1,5-99999999999'])
        expect(parse(string).headerError).toBe(BAD_REQUEST);
    });

    test('step beyond the limit, but no value beyond the limit', () => {
      expect(parse('1:15:20')).toEqual([{ start: 0, end: 0 }]);
    });

    test('step 0', () => {
      expect(parse('1:10:0').headerError).toBe(BAD_REQUEST);
    });
  });

  describe('parse step format', () => {
    test('all defined', () => {
      expect(parse('1:9:2')).toEqual([
        { start: 0, end: 0 }, { start: 2, end: 2 }, { start: 4, end: 4 }, { start: 6, end: 6 }, { start: 8, end: 8 },
      ]);
      expect(parse('1:1:2')).toEqual([{ start: 0, end: 0 }]);
      expect(parse('1:2:2')).toEqual([{ start: 0, end: 0 }]);
      expect(parse('1:3:2')).toEqual([{ start: 0, end: 0 }, { start: 2, end: 2 }]);
      expect(parse('1:3:1')).toEqual([{ start: 0, end: 2 }]);
      expect(parse('9:10:1')).toEqual([{ start: 8, end: 9 }]);
      // end lower than start 🤷‍
      expect(parse('3:1:1')).toEqual([{ start: 2, end: 2 }]);
    });

    test('implied step', () => {
      expect(parse('1:1')).toEqual([{ start: 0, end: 0 }]);
      expect(parse('1:2')).toEqual([{ start: 0, end: 1 }]);
      expect(parse('1:3')).toEqual([{ start: 0, end: 2 }]);
    });

    test('negative end counts from the limit', () => {
      expect(parse('1:-1')).toEqual([{ start: 0, end: 9 }]);
      expect(parse('5:-2')).toEqual([{ start: 4, end: 8 }]);
    });
  });

  describe('parse range format', () => {
    test('simple numbers', () => {
      expect(parse('1')).toEqual([{ start: 0, end: 0 }]);
      expect(parse('1,1')).toEqual([{ start: 0, end: 0 }]);
      expect(parse('1,2')).toEqual([{ start: 0, end: 1 }]);
      expect(parse('10')).toEqual([{ start: 9, end: 9 }]);
      expect(parse('5,10')).toEqual([{ start: 4, end: 4 }, { start: 9, end: 9 }]);
      expect(parse('5,10,5')).toEqual([{ start: 4, end: 4 }, { start: 9, end: 9 }]);
      expect(parse('3,1')).toEqual([{ start: 0, end: 0 }, { start: 2, end: 2 }]);
    });

    test('simple range', () => {
      expect(parse('1-2')).toEqual([{ start: 0, end: 1 }]);
      expect(parse('3-5')).toEqual([{ start: 2, end: 4 }]);
      expect(parse('2-4,9-10')).toEqual([{ start: 1, end: 3 }, { start: 8, end: 9 }]);
      // end lower than start
      expect(parse('4-2')).toEqual([{ start: 3, end: 3 }]);
    });

    test('combined', () => {
      expect(parse('1,5-6')).toEqual([{ start: 0, end: 0 }, { start: 4, end: 5 }]);
    });

    test('overlapping and consecutive ranges are merged', () => {
      expect(parse('1-3,4-5')).toEqual([{ start: 0, end: 4 }]);
      expect(parse('5-8,2-6,1')).toEqual([{ start: 0, end: 7 }]);
      expect(parse('2-4,3,9')).toEqual([{ start: 1, end: 3 }, { start: 8, end: 8 }]);
    });

    test('huge and repeated ranges are not expanded', () => {
      const limit = 99999999999;
      const repeated = Array(10000).fill(`1-${limit}`).join(',');
      expect(parseQueryRange(repeated, limit, 'frames')).toEqual([{ start: 0, end: limit - 1 }]);
    });
  });
});

describe('rangeIndices', () => {
  test('packs consecutive indices', () => {
    expect(rangeIndices([])).toEqual([]);
    expect(rangeIndices([4])).toEqual([{ start: 4, end: 4 }]);
    expect(rangeIndices([0, 1, 2, 5, 7, 8])).toEqual([{ start: 0, end: 2 }, { start: 5, end: 5 }, { start: 7, end: 8 }]);
  });
});

describe('rangeNotation', () => {
  test('writes indices in ranged notation', () => {
    expect(rangeNotation([1, 2, 3, 5])).toBe('1-3,5');
    expect(rangeNotation([7])).toBe('7');
  });
});
