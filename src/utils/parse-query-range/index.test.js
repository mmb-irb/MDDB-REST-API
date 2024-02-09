const parseQueryRange = require('.');

describe('parseQueryRange', () => {
  describe('edge cases', () => {
    test('nonsense input', () => {
      expect(parseQueryRange('nonsense')).toBe(undefined);
      expect(parseQueryRange('0,lkjsadjk,5')).toBe(undefined);
      expect(parseQueryRange('0-1,5,lkjsadjk,7')).toBe(undefined);
    });

    test('too many numbers in step format', () => {
      expect(parseQueryRange('1:10:2:4')).toBe(undefined);
    });

    test('step format, but start at 0', () => {
      expect(parseQueryRange('0:10:2')).toBe(undefined);
    });

    test('case 0', () => {
      expect(parseQueryRange('0')).toBe(undefined);
    });

    test('contains 0', () => {
      expect(parseQueryRange('0,5')).toBe(undefined);
      expect(parseQueryRange('5,0')).toBe(undefined);
    });
  });

  describe('parse step format', () => {
    test('all defined', () => {
      expect(parseQueryRange('1:9:2')).toBe('0-0,2-2,4-4,6-6,8-8');
      expect(parseQueryRange('1:1:2')).toBe('0-0');
      expect(parseQueryRange('1:2:2')).toBe('0-0');
      expect(parseQueryRange('1:3:2')).toBe('0-0,2-2');
      expect(parseQueryRange('1:3:1')).toBe('0-0,1-1,2-2');
      expect(parseQueryRange('9:10:1')).toBe('8-8,9-9');
      // end lower than start 🤷‍
      expect(parseQueryRange('3:1:1')).toBe('2-2');
    });

    test('implied step', () => {
      expect(parseQueryRange('1:1')).toBe('0-0');
      expect(parseQueryRange('1:2')).toBe('0-0,1-1');
      expect(parseQueryRange('1:3')).toBe('0-0,1-1,2-2');
    });
  });

  describe('parse range format', () => {
    test('simple numbers', () => {
      expect(parseQueryRange('1')).toBe('0-0');
      expect(parseQueryRange('1,1')).toBe('0-0');
      expect(parseQueryRange('1,2')).toBe('0-0,1-1');
      expect(parseQueryRange('20')).toBe('19-19');
      expect(parseQueryRange('5,10')).toBe('4-4,9-9');
      expect(parseQueryRange('5,10,5')).toBe('4-4,9-9');
      expect(parseQueryRange('3,1')).toBe('0-0,2-2');
    });

    test('simple range', () => {
      expect(parseQueryRange('1-2')).toBe('0-0,1-1');
      expect(parseQueryRange('3-5')).toBe('2-2,3-3,4-4');
      expect(parseQueryRange('2-4,9-10')).toBe(
        '1-1,2-2,3-3,8-8,9-9',
      );
    });

    test('combined', () => {
      expect(parseQueryRange('1,5-6')).toBe('0-0,4-4,5-5');
    });
  });
});
