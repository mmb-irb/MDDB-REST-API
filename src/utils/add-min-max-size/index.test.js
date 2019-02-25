const addMinMaxSize = require(__dirname);

describe('Corner cases', () => {
  test('No range', () => {
    expect(addMinMaxSize()).toBeUndefined();
    expect(addMinMaxSize([])).toBeUndefined();
  });

  test('error cases', () => {
    expect(addMinMaxSize(-1)).toBe(-1);
    expect(addMinMaxSize(-2)).toBe(-2);
  });
});

test('No side effects', () => {
  const input = [{ start: 1, end: 3 }];
  const output = addMinMaxSize(input);
  expect(output).not.toBe(input);
  expect(Array.from(output)).toEqual(Array.from(input));
});

describe('Basic cases', () => {
  test('one range', () => {
    const input = [{ start: 5, end: 6 }];
    input.type = 'bytes';
    const output = addMinMaxSize(input, 10);
    const expected = [{ start: 5, end: 6 }];
    expected.type = 'bytes';
    expected.min = 5;
    expected.max = 6;
    expected.size = 2;
    expect(output).toEqual(expected);
  });

  test('ordered', () => {
    const input = [{ start: 1, end: 1 }, { start: 5, end: 6 }];
    input.type = 'bytes';
    const output = addMinMaxSize(input, 10);
    const expected = [{ start: 1, end: 1 }, { start: 5, end: 6 }];
    expected.type = 'bytes';
    expected.min = 1;
    expected.max = 6;
    expected.size = 3;
    expect(output).toEqual(expected);
  });

  test('unordered', () => {
    const input = [{ start: 5, end: 6 }, { start: 1, end: 1 }];
    input.type = 'bytes';
    const output = addMinMaxSize(input, 10);
    const expected = [{ start: 1, end: 1 }, { start: 5, end: 6 }];
    expected.type = 'bytes';
    expected.min = 1;
    expected.max = 6;
    expected.size = 3;
    expect(output).toEqual(expected);
  });
});
