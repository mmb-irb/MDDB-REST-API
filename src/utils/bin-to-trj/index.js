const { Transform } = require('stream');

module.exports = function() {
  let globalCount = 0;
  const transform = new Transform({
    transform(chunk, _encoding, next) {
      let output = '';
      for (let index = 0; index < chunk.length; index += 4) {
        const value = chunk.readFloatLE(index);
        const [left, right] = value.toFixed(3).split('.');
        const paddedLeft = left.padStart(4, ' ');
        const end = ++globalCount % 10 ? '' : '\n';
        output += `${paddedLeft}.${right}${end}`;
      }
      const canContinue = this.push(output, 'ascii');
      if (canContinue) {
        next();
      } else {
        this._readableState.pipes.once('drain', next);
      }
    },
  });
  transform.setEncoding('ascii');
  return transform;
};

// 1 coordinate: 4 bytes in binary, 8 in plain text -> ratio 2
// also, every 10 coordinates (or 80 bytes), add a newline character -> 1 / 80
// equation:
//   text_bytes = floor(binary_bytes * 2 + binary_bytes / 80)
//   = floor(2.025 * binary_bytes)
module.exports.MULTIPLIER = x => Math.floor(2.025 * x);
