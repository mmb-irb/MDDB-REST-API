const { Transform } = require('stream');

module.exports = function() {
  // keep track of the number of coordinates processed in the line
  let countInLine = 1;
  const transform = new Transform({
    transform(chunk, _encoding, next) {
      let output = ''; // will be concatenated over and over in the loop
      // loop over the size of the chunk, jumping every 4 bytes
      for (let index = 0; index < chunk.length; index += 4) {
        output += chunk
          .readFloatLE(index) // read the float value and the given index
          .toFixed(3) // round to 3 decimals, stringify, and pad end with 0
          .padStart(8, ' '); // pad start with space to use up all 8 characters
        // if countInLine !== 10
        if (countInLine ^ 10) {
          // every other time
          countInLine++; // increment counter
        } else {
          // every 10 coordinates
          output += '\n'; // add newline character
          countInLine = 1; // reset counter
        }
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
