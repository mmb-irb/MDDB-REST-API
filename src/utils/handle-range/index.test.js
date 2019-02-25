const handleRange = require(__dirname);

const ATOM_SIZE = Float32Array.BYTES_PER_ELEMENT * 3;

const descriptor = {
  length: 108,
  metadata: {
    frames: 3,
    atoms: 3,
  },
};

describe('Corner cases', () => {
  test('no range', () => {
    expect(handleRange()).toBeUndefined();
    expect(handleRange('')).toBeUndefined();
  });

  test('invalid range type', () => {
    expect(handleRange('apples=0-10')).toBeUndefined();
  });
});

describe('With byte range', () => {
  test('only byte range', () => {
    const expected = [{ start: 0, end: 19 }];
    expect(Array.from(handleRange('bytes=0-9,10-19', { length: 100 }))).toEqual(
      expected,
    );
  });

  test('invalid range, followed by byte range', () => {
    const expected = [{ start: 0, end: 19 }];
    expect(
      Array.from(handleRange('apples=0-10, bytes=0-9,10-19', { length: 100 })),
    ).toEqual(expected);
  });

  test('byte range, followed by invalid range', () => {
    const expected = [{ start: 0, end: 19 }];
    expect(
      Array.from(handleRange('bytes=0-9,10-19, apples=0-10', descriptor)),
    ).toEqual(expected);
  });

  test('frame range, followed by byte range', () => {
    const expected = [{ start: 0, end: 19 }];
    expect(
      Array.from(handleRange('frame=0-1, bytes=0-9,10-19', descriptor)),
    ).toEqual(expected);
  });

  test('byte range, followed by frame range', () => {
    const expected = [{ start: 0, end: 19 }];
    expect(
      Array.from(handleRange('bytes=0-9,10-19, frame=0-1', descriptor)),
    ).toEqual(expected);
  });
});

describe('Frames', () => {
  test('first frame', () => {
    const expected = [{ start: 0, end: 35 }];
    expect(Array.from(handleRange('frames=0-0', descriptor))).toEqual(expected);
  });

  test('middle frame', () => {
    const expected = [{ start: 36, end: 71 }];
    expect(Array.from(handleRange('frames=1-1', descriptor))).toEqual(expected);
  });

  test('last frame', () => {
    const expected = [{ start: 72, end: 107 }];
    expect(Array.from(handleRange('frames=2-2', descriptor))).toEqual(expected);
  });

  test('out of range frame', () => {
    expect(handleRange('frames=3-3', descriptor)).toBe(-1);
  });
});

describe('Atoms', () => {
  test('first atom', () => {
    const expected = [
      { start: 0, end: 11 },
      { start: 36, end: 47 },
      { start: 72, end: 83 },
    ];
    expect(Array.from(handleRange('atoms=0-0', descriptor))).toEqual(expected);
  });

  test('middle atom', () => {
    const expected = [
      { start: 12, end: 23 },
      { start: 48, end: 59 },
      { start: 84, end: 95 },
    ];
    expect(Array.from(handleRange('atoms=1-1', descriptor))).toEqual(expected);
  });

  test('last atom', () => {
    const expected = [
      { start: 24, end: 35 },
      { start: 60, end: 71 },
      { start: 96, end: 107 },
    ];
    expect(Array.from(handleRange('atoms=2-2', descriptor))).toEqual(expected);
  });

  test('out of range atom', () => {
    expect(handleRange('atoms=3-3', descriptor)).toBe(-1);
  });
});

describe('Frames + atoms', () => {
  test('first atom of first frame', () => {
    const expected = [{ start: 0, end: 11 }];
    expect(
      Array.from(handleRange('frames=0-0, atoms=0-0', descriptor)),
    ).toEqual(expected);
    expect(
      Array.from(handleRange('atoms=0-0, frames=0-0', descriptor)),
    ).toEqual(expected);
  });

  test('middle atom of middle frame', () => {
    const expected = [{ start: 48, end: 59 }];
    expect(
      Array.from(handleRange('frames=1-1, atoms=1-1', descriptor)),
    ).toEqual(expected);
    expect(
      Array.from(handleRange('atoms=1-1, frames=1-1', descriptor)),
    ).toEqual(expected);
  });

  test('last atom of last frame', () => {
    const expected = [{ start: 96, end: 107 }];
    expect(
      Array.from(handleRange('frames=2-2, atoms=2-2', descriptor)),
    ).toEqual(expected);
    expect(
      Array.from(handleRange('atoms=2-2, frames=2-2', descriptor)),
    ).toEqual(expected);
  });

  test('first atom of last frame', () => {
    const expected = [{ start: 72, end: 83 }];
    expect(
      Array.from(handleRange('frames=2-2, atoms=0-0', descriptor)),
    ).toEqual(expected);
    expect(
      Array.from(handleRange('atoms=0-0, frames=2-2', descriptor)),
    ).toEqual(expected);
  });

  test('last atom of first frame', () => {
    const expected = [{ start: 24, end: 35 }];
    expect(
      Array.from(handleRange('frames=0-0, atoms=2-2', descriptor)),
    ).toEqual(expected);
    expect(
      Array.from(handleRange('atoms=2-2, frames=0-0', descriptor)),
    ).toEqual(expected);
  });
});
