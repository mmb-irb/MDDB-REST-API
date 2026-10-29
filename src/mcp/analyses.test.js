const { getAnalysis, selectPart, summarize } = require('./analyses');

const range = (length, value) => Array.from({ length }, (_, index) => value(index));
const indices = length => range(length, index => index);

describe('summarize', () => {
  it('replaces long numeric lists by their statistics, counting nulls but indexing the original list', () => {
    expect(summarize([null, 3, 1, ...range(20, () => 2), 5])).toEqual({
      length: 24, nulls: 1, min: 1, max: 5, mean: 2.13043, std: 0.679152, argmin: 2, argmax: 23, first: null, last: 5,
    });
  });

  it('keeps short lists whole, rounding to 6 significant digits but keeping integers exact', () => {
    expect(summarize([0.7994049999999999, 1234567, true])).toEqual([0.799405, 1234567, true]);
  });

  it('counts the true values of long boolean lists and matrices', () => {
    expect(summarize(range(30, index => index < 3))).toEqual({ length: 30, true: 3 });
    expect(summarize(range(25, () => [true, false]))).toEqual({ shape: [25, 2], true: 25 });
  });

  it('replaces long matrices by their statistics, with [row, column] positions', () => {
    const matrix = range(30, row => range(4, column => row === 7 && column === 2 ? 9 : 1));
    expect(summarize(matrix)).toMatchObject({ shape: [30, 4], min: 1, max: 9, argmin: [0, 0], argmax: [7, 2] });
  });

  it('summarizes each row of a short matrix, like the PCA projections', () => {
    expect(summarize([indices(30), indices(30)])).toEqual([
      expect.objectContaining({ length: 30, max: 29 }),
      expect.objectContaining({ length: 30, max: 29 }),
    ]);
  });

  it('shows the head of long lists of texts and objects', () => {
    expect(summarize(range(30, index => `A:${index}`))).toEqual({ length: 30, head: ['A:0', 'A:1', 'A:2', 'A:3', 'A:4'] });
    expect(summarize(range(30, index => ({ from: index, frames: indices(30) })))).toMatchObject({
      length: 30, head: range(5, index => ({ from: index, frames: { length: 30 } })),
    });
  });

  it('keeps index analyses as they are', () => {
    const index = [{ name: 'Overall', analysis: 'clusters-00' }];
    expect(summarize(index)).toEqual(index);
  });

  it('cuts long texts and objects with many keys', () => {
    expect(summarize('x'.repeat(300))).toBe('x'.repeat(200) + '…');
    const summary = summarize(Object.fromEntries(range(60, index => [`key${index}`, index])));
    expect(Object.keys(summary)).toHaveLength(51);
    expect(summary).toMatchObject({ key49: 49, '…': '10 more keys' });
  });
});

describe('selectPart', () => {
  const analysis = {
    start: 0, step: 2,
    data: [{ values: range(1000, index => index / 10), reference: 'firstframe' }, { values: [] }],
    hbonds: range(3, () => range(199, index => index % 2 === 0)),
    rmsds: range(200, row => range(200, column => row + column)),
    transitions: range(30, index => ({ from: index, to: index + 1, count: 1 })),
  };

  it('downsamples a series to maxPoints, keeping every stride-th value', () => {
    expect(selectPart(analysis, 'data.0.values', undefined, 100)).toEqual({
      length: 1000, offset: 0, stride: 10, values: range(100, index => index),
    });
  });

  it('cuts the list to range before downsampling', () => {
    expect(selectPart(analysis, 'data.0.values', [500, 504], 100)).toEqual({
      length: 4, offset: 500, stride: 1, values: [50, 50.1, 50.2, 50.3],
    });
  });

  it('keeps every row of a wide matrix and downsamples its columns', () => {
    const part = selectPart(analysis, 'hbonds', undefined, 200);
    expect(part).toMatchObject({ shape: [3, 199], stride: [1, 4] });
    expect(part.values).toHaveLength(3);
    expect(part.values[0]).toHaveLength(50);
  });

  it('downsamples a square matrix evenly', () => {
    const part = selectPart(analysis, 'rmsds', undefined, 25);
    expect(part).toMatchObject({ shape: [200, 200], stride: [40, 40] });
    expect(part.values[1]).toEqual([40, 80, 120, 160, 200]);
  });

  it('returns other lists item by item', () => {
    expect(selectPart(analysis, 'transitions', [2, 4], 200)).toEqual({
      length: 2, offset: 2, items: [{ from: 2, to: 3, count: 1 }, { from: 3, to: 4, count: 1 }],
    });
  });

  it('names what is there when the path is wrong', () => {
    expect(() => selectPart(analysis, 'data.0.valuez', undefined, 200))
      .toThrow('No "valuez" in data.0. Available: values, reference');
    expect(() => selectPart(analysis, 'data.7', undefined, 200)).toThrow('No "7" in data. Available: indices 0-1');
    expect(() => selectPart(analysis, 'step.x', undefined, 200)).toThrow('No "x" in step. Available: none');
  });
});

describe('getAnalysis', () => {
  it('summarizes the analysis of the requested MD', async () => {
    const api = jest.fn(async () => ({ step: 2, data: indices(30) }));
    expect(await getAnalysis(api, { accession: 'A01YJ.2', name: 'rmsds' }))
      .toEqual({ step: 2, data: expect.objectContaining({ length: 30 }) });
    expect(api).toHaveBeenCalledWith('projects/A01YJ.2/analyses/rmsds');
  });

  it('refuses results that would flood the context, naming the parts and their sizes', async () => {
    const parts = Object.fromEntries(range(40, index => [`part${index}`, range(20, () => 'x'.repeat(100))]));
    const api = jest.fn(async () => ({ data: { output: parts } }));
    await expect(getAnalysis(api, { accession: 'A0001', name: 'channels' }))
      .rejects.toThrow(/^The result is \d+ characters long. Read a part of it with path: data\.output\.part0 \(\d+ chars\), data\.output\.part1/);
  });
});
