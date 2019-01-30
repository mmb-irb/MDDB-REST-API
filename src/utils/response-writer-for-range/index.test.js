const responseWriterForRange = require(__dirname);

class MockResponse {
  constructor() {
    this._content = [];
  }

  write(buffer) {
    this._content.push(...buffer);
  }

  get content() {
    return Buffer.from(this._content);
  }
}

const LENGTH = 20;

const originalContent = Buffer.from(
  Array.from({ length: LENGTH }, (_, i) => i + 1),
);

const contentGenerator = function*(slices, start, end) {
  const view = Buffer.allocUnsafe(
    end ? end - start + 1 : originalContent.length,
  );
  originalContent.copy(view, 0, start, end && end + 1);
  let previous = 0;
  for (const slice of slices) {
    yield view.slice(previous, slice);
    previous = slice;
  }
  yield view.slice(previous);
};

const slicesToDesc = slices => [0, ...slices, LENGTH].join('|');

const possibleSlices = [
  [],
  [0],
  [1],
  [1, 3],
  [5],
  [6],
  [10],
  [7, 15],
  [5, 10, 15],
  [5, 10, 10, 15],
  [5, 10, 11, 15],
  [18, 19],
  [19],
  [20],
];

let response;

beforeEach(() => {
  response = new MockResponse();
});

describe('no range', () => {
  const expected = Buffer.from(Array.from(originalContent));
  possibleSlices.forEach(slices => {
    test(`range undefined (buffer slices: ${slicesToDesc(slices)})`, () => {
      const writer = responseWriterForRange(undefined, response);
      for (const part of contentGenerator(slices)) {
        writer(part);
      }
      expect(response.content).toEqual(expected);
    });
    test(`range empty (buffer slices: ${slicesToDesc(slices)})`, () => {
      const writer = responseWriterForRange([], response);
      for (const part of contentGenerator(slices)) {
        writer(part);
      }
      expect(response.content).toEqual(expected);
    });
  });
});

describe('single range', () => {
  {
    const range = [{ start: 0, end: 4 }];
    range.min = 0;
    range.max = 4;
    const expected = Buffer.from([1, 2, 3, 4, 5]);
    possibleSlices.forEach(slices => {
      test(`from start, pre-sliced (buffer slices: ${slicesToDesc(
        slices,
      )})`, () => {
        const writer = responseWriterForRange(range, response, true);
        for (const part of contentGenerator(slices, range.min, range.max)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
      test(`from start (buffer slices: ${slicesToDesc(slices)})`, () => {
        const writer = responseWriterForRange(range, response);
        for (const part of contentGenerator(slices)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
    });
  }
  {
    const range = [{ start: 14, end: 19 }];
    range.min = 14;
    range.max = 19;
    const expected = Buffer.from([15, 16, 17, 18, 19, 20]);
    possibleSlices.forEach(slices => {
      test(`from end, pre-sliced (buffer slices: ${slicesToDesc(
        slices,
      )})`, () => {
        const writer = responseWriterForRange(range, response, true);
        for (const part of contentGenerator(slices, range.min, range.max)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
      test(`from end (buffer slices: ${slicesToDesc(slices)})`, () => {
        const writer = responseWriterForRange(range, response);
        for (const part of contentGenerator(slices)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
    });
  }
  {
    const range = [{ start: 7, end: 11 }];
    range.min = 7;
    range.max = 11;
    const expected = Buffer.from([8, 9, 10, 11, 12]);
    possibleSlices.forEach(slices => {
      test(`from middle, pre-sliced (buffer slices: ${slicesToDesc(
        slices,
      )})`, () => {
        const writer = responseWriterForRange(range, response, true);
        for (const part of contentGenerator(slices, range.min, range.max)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
      test(`from middle (buffer slices: ${slicesToDesc(slices)})`, () => {
        const writer = responseWriterForRange(range, response);
        for (const part of contentGenerator(slices)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
    });
  }
});

describe('multiple ranges', () => {
  {
    const range = [{ start: 0, end: 4 }, { start: 10, end: 14 }];
    range.min = 0;
    range.max = 14;
    const expected = Buffer.from([1, 2, 3, 4, 5, 11, 12, 13, 14, 15]);
    possibleSlices.forEach(slices => {
      test(`from start, pre-sliced (buffer slices: ${slicesToDesc(
        slices,
      )})`, () => {
        const writer = responseWriterForRange(range, response, true);
        for (const part of contentGenerator(slices, range.min, range.max)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
      test(`from start (buffer slices: ${slicesToDesc(slices)})`, () => {
        const writer = responseWriterForRange(range, response);
        for (const part of contentGenerator(slices)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
    });
  }
  {
    const range = [{ start: 10, end: 11 }, { start: 14, end: 19 }];
    range.min = 10;
    range.max = 19;
    const expected = Buffer.from([11, 12, 15, 16, 17, 18, 19, 20]);
    possibleSlices.forEach(slices => {
      test(`from end, pre-sliced (buffer slices: ${slicesToDesc(
        slices,
      )})`, () => {
        const writer = responseWriterForRange(range, response, true);
        for (const part of contentGenerator(slices, range.min, range.max)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
      test(`from end (buffer slices: ${slicesToDesc(slices)})`, () => {
        const writer = responseWriterForRange(range, response);
        for (const part of contentGenerator(slices)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
    });
  }
  {
    const range = [{ start: 7, end: 11 }, { start: 14, end: 16 }];
    range.min = 7;
    range.max = 16;
    const expected = Buffer.from([8, 9, 10, 11, 12, 15, 16, 17]);
    possibleSlices.forEach(slices => {
      test(`from middle, pre-sliced (buffer slices: ${slicesToDesc(
        slices,
      )})`, () => {
        const writer = responseWriterForRange(range, response, true);
        for (const part of contentGenerator(slices, range.min, range.max)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
      test(`from middle (buffer slices: ${slicesToDesc(slices)})`, () => {
        const writer = responseWriterForRange(range, response);
        for (const part of contentGenerator(slices)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
    });
  }
  {
    const range = [
      { start: 1, end: 4 },
      { start: 7, end: 11 },
      { start: 14, end: 16 },
    ];
    range.min = 1;
    range.max = 16;
    const expected = Buffer.from([2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 16, 17]);
    possibleSlices.forEach(slices => {
      test(`three ranges, pre-sliced (buffer slices: ${slicesToDesc(
        slices,
      )})`, () => {
        const writer = responseWriterForRange(range, response, true);
        for (const part of contentGenerator(slices, range.min, range.max)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
      test(`three ranges (buffer slices: ${slicesToDesc(slices)})`, () => {
        const writer = responseWriterForRange(range, response);
        for (const part of contentGenerator(slices)) {
          writer(part);
        }
        expect(response.content).toEqual(expected);
      });
    });
  }
});
