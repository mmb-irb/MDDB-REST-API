const { createReadStream } = require('fs');
const { Readable } = require('stream');

const consumeStream = require('.');

describe('consumeStream()', () => {
  test('should return empty buffer if no content', async () => {
    const stream = Readable.from(Buffer.from([]));
    expect(await consumeStream(stream)).toEqual(Buffer.from([]));
  });

  test('should return buffer from stream', async () => {
    const stream = createReadStream(`${__dirname}/text-file.test.txt`);
    expect(await consumeStream(stream)).toEqual(Buffer.from('Hello'));
  });
});
