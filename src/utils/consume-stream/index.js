const consumeStream = async stream => {
  const buffers = [];
  for await (const data of stream) {
    buffers.push(data);
  }
  return Buffer.concat(buffers);
};

module.exports = consumeStream;
