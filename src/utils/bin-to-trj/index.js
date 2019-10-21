const { Transform } = require('stream');

module.exports = function() {
  let globalCount = 0;
  const transform = new Transform({
    transform(chunk, _encoding, next) {
      let output = '';
      for (let index = 0; index < chunk.length; index += 4) {
        const value = Math.round(chunk.readFloatLE(index) * 1000) / 1000;
        const [left, right = ''] = value.toString(10).split('.');
        output += `${left.padStart(4, ' ')}.${right.padEnd(3, '0')}${
          ++globalCount % 10 ? '' : '\n'
        }`;
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
