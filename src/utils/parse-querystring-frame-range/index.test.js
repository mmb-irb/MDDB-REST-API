const parseQuerystringFrameRange = require('.');

describe('parseQuerystringFrameRange', () => {
  describe('edge cases', () => {
    test('nonsense input', () => {
      expect(parseQuerystringFrameRange('nonsense')).toBe(undefined);
      expect(parseQuerystringFrameRange('0,lkjsadjk,5')).toBe(undefined);
      expect(parseQuerystringFrameRange('0-1,5,lkjsadjk,7')).toBe(undefined);
    });

    test('too many numbers in step format', () => {
      expect(parseQuerystringFrameRange('1:10:2:4')).toBe(undefined);
    });

    test('step format, but start at 0', () => {
      expect(parseQuerystringFrameRange('0:10:2')).toBe(undefined);
    });

    test('case 0', () => {
      expect(parseQuerystringFrameRange('0')).toBe(undefined);
    });

    test('contains 0', () => {
      expect(parseQuerystringFrameRange('0,5')).toBe(undefined);
      expect(parseQuerystringFrameRange('5,0')).toBe(undefined);
    });
  });

  describe('parse step format', () => {
    test('all defined', () => {
      expect(parseQuerystringFrameRange('1:9:2')).toBe('0-0,2-2,4-4,6-6,8-8');
      expect(parseQuerystringFrameRange('1:1:2')).toBe('0-0');
      expect(parseQuerystringFrameRange('1:2:2')).toBe('0-0');
      expect(parseQuerystringFrameRange('1:3:2')).toBe('0-0,2-2');
      expect(parseQuerystringFrameRange('1:3:1')).toBe('0-0,1-1,2-2');
      expect(parseQuerystringFrameRange('9:10:1')).toBe('8-8,9-9');
      // end lower than start 🤷‍
      expect(parseQuerystringFrameRange('3:1:1')).toBe('2-2');
    });

    test('implied step', () => {
      expect(parseQuerystringFrameRange('1:1')).toBe('0-0');
      expect(parseQuerystringFrameRange('1:2')).toBe('0-0,1-1');
      expect(parseQuerystringFrameRange('1:3')).toBe('0-0,1-1,2-2');
    });
  });

  describe('parse range format', () => {
    test('simple numbers', () => {
      expect(parseQuerystringFrameRange('1')).toBe('0-0');
      expect(parseQuerystringFrameRange('1,1')).toBe('0-0');
      expect(parseQuerystringFrameRange('1,2')).toBe('0-0,1-1');
      expect(parseQuerystringFrameRange('20')).toBe('19-19');
      expect(parseQuerystringFrameRange('5,10')).toBe('4-4,9-9');
      expect(parseQuerystringFrameRange('5,10,5')).toBe('4-4,9-9');
      expect(parseQuerystringFrameRange('3,1')).toBe('0-0,2-2');
    });

    test('simple range', () => {
      expect(parseQuerystringFrameRange('1-2')).toBe('0-0,1-1');
      expect(parseQuerystringFrameRange('3-5')).toBe('2-2,3-3,4-4');
      expect(parseQuerystringFrameRange('2-4,9-10')).toBe(
        '1-1,2-2,3-3,8-8,9-9',
      );
    });

    test('combined', () => {
      expect(parseQuerystringFrameRange('1,5-6')).toBe('0-0,4-4,5-5');
    });
  });
});
