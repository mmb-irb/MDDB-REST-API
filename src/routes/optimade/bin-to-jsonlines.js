// Transform stream: raw float32-LE binary trajectory → NDJSON (one frame per line)
// Input: flat array of float32-LE values, layout [frame][atom][xyz]
// Output: one JSON line per frame: "[[x,y,z],[x,y,z],...]\n"
const { Transform } = require('stream');

class BinToJsonlinesStream extends Transform {
  constructor(atomCount) {
    super();
    this.atomCount = atomCount;
    this.frameSize = atomCount * 3 * 4; // bytes per frame (float32 = 4 bytes)
    this._buf = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    this._buf = Buffer.concat([this._buf, chunk]);
    while (this._buf.length >= this.frameSize) {
      const frame = [];
      for (let i = 0; i < this.atomCount; i++) {
        const o = i * 12;
        frame.push([
          this._buf.readFloatLE(o),
          this._buf.readFloatLE(o + 4),
          this._buf.readFloatLE(o + 8),
        ]);
      }
      this.push(JSON.stringify(frame) + '\n');
      this._buf = this._buf.slice(this.frameSize);
    }
    callback();
  }

  _flush(callback) {
    callback();
  }
}

module.exports = BinToJsonlinesStream;
