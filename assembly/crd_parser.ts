// This script is not in JavaScript, but in AssemblyScript
// This code needs to be compiled when updated. Use "sudo npm run build"
// This is used to conver binary data from the database to mdcrd format
// The entry file of your WebAssembly module.

const VALUES_PER_LINE = 10;

const numberToASCII = (n: u8): u8 => n + 48;
const SPACE = u8(32);
const DOT = u8(46);
const MINUS = u8(45);
const NEWLINE = u8(10);
let countInFrame = usize(1);
let countInLine = u8(1);

export function transform(nValues: usize, nValuesPerFrame: usize, outputOffset: usize): u8 {
  let outputIndex = outputOffset;
  for (let i = usize(0); i < nValues; i++) {
    // read data from input part of the memory
    const extracted = load<f32>(i * 4);

    // extract sign information
    const sign = Math.sign(extracted);
    const value = u32(Math.abs(Math.round(extracted * 1_000)));

    let accumulated = u32(0);

    // separate value into units
    // position 1: 1000
    const thousands = u8(value / 1_000_000);
    accumulated += thousands * u32(1_000_000);
    // position 2: 100
    const hundreds = u8((value - accumulated) / 100_000);
    accumulated += hundreds * u32(100_000);
    // position 3: 10
    const tens = u8((value - accumulated) / 10_000);
    accumulated += tens * u32(10_000);
    // position 4: 1
    const units = u8((value - accumulated) / 1_000);
    accumulated += units * u32(1_000);

    // position 5: '.' decimal separator
    //  -> nothing to calculate

    // position 6: .1
    const tenths = u8((value - accumulated) / 100);
    accumulated += tenths * u32(100);
    // position 7: .01
    const hundredths = u8((value - accumulated) / 10);
    accumulated += hundredths * u32(10);
    // position 8: 0.001
    const thousandths = u8(value - accumulated);

    // write values at the right place
    // position 1: 1000
    if (thousands === 0) {
      if (sign === -1 && hundreds !== 0) {
        store<u8>(outputIndex++, MINUS);
      } else {
        store<u8>(outputIndex++, SPACE);
      }
    } else {
      store<u8>(outputIndex++, numberToASCII(thousands));
    }
    // position 2: 100
    if (hundreds === 0 && thousands === 0) {
      if (sign === -1 && tens !== 0) {
        store<u8>(outputIndex++, MINUS);
      } else {
        store<u8>(outputIndex++, SPACE);
      }
    } else {
      store<u8>(outputIndex++, numberToASCII(hundreds));
    }
    // position 3: 10
    if (tens === 0 && hundreds === 0 && thousands === 0) {
      if (sign === -1) { // The sign goes here even if units === 0
        store<u8>(outputIndex++, MINUS);
      } else {
        store<u8>(outputIndex++, SPACE);
      }
    } else {
      store<u8>(outputIndex++, numberToASCII(tens));
    }
    // position 4: 1
    store<u8>(outputIndex++, numberToASCII(units));

    // position 5: '.' decimal separator
    store<u8>(outputIndex++, DOT);

    // position 6: .1
    store<u8>(outputIndex++, numberToASCII(tenths));
    // position 7: .01
    store<u8>(outputIndex++, numberToASCII(hundredths));
    // position 8: 0.001
    store<u8>(outputIndex++, numberToASCII(thousandths));

    // if countInLine !== 10, but written as a bitwise operation
    if (countInLine ^ VALUES_PER_LINE) {
      countInLine++;
    } else {
      // every 10 coordinates
      store<u8>(outputIndex++, NEWLINE);
      countInLine = 1;
    }
    // Add a breakline between frames
    if (countInFrame < nValuesPerFrame) {
      countInFrame++;
    } else {
      store<u8>(outputIndex++, NEWLINE);
      countInFrame = 1;
      countInLine = 1;
    }
  }
  return countInLine;
}
