// Wait for all the pieces (buffers) of the stream
// Concatenate all pieces into a single piece which is then returned
const consumeStream = async stream => {
  const buffers = [];
  for await (const data of stream) {
    buffers.push(data);
  }
  return Buffer.concat(buffers);
};

module.exports = consumeStream;
