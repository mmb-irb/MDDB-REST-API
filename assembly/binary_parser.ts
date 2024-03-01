// This script is not in JavaScript, but in AssemblyScript
// This code needs to be compiled when updated. Use "sudo npm run build"
// This is used to conver binary data to actual values

// To debug this script use the function 'trace' instead of 'console.log'

// DANI: Tema u8 nos funciona porque el bitsize es menor que 8, pero hay que replantear para tamaños mayores

// toString(2) is not working in assembly script so we have to do our own int to binary string function
function intToBinString (number : u8): string {
  let binaryString = '';
  let num = number;
  while (num > 0) {
    binaryString = (num % 2).toString() + binaryString;
    num = u8(num / 2); // We can truncate since we always use positive numbers
  }
  return binaryString.padStart(8, "0");
}

// Convert a numeric value to actual text
const numberToASCII = (n: u8): u8 => n + 48;

// Byte start and end are regarding the current data chunk and thus the WASM memory
// Bit start and end are regarding the previously mentioned byte range inside the data chunk
// Output start stands for the byte in the WASM memory
export function transform(
  byteStart: usize,
  byteEnd: usize,
  bitStart: usize,
  bitEnd: usize,
  bitSize: usize,
  outputStart: usize
): void {
  // Process the first byte apart since first bits may be discarded
  // Read the selected binary range and parse it to string
  let byte = byteStart;
  let extracted = load<u8>(byte);
  let binaryString = intToBinString(extracted).substring(bitStart);
  byte++;
  // Now iterate over the rest of bytes
  let bit = usize(0);
  let bitsToProcess = usize(0);
  let outputByte = outputStart;
  let currentBitString = '';
  let currentValue = u8(0)
  while (byte < byteEnd) {
    //if (byte % 10000 === 0) trace(byte.toString() + '/' + byteEnd.toString() + '\r');
    // Read data from input part of the memory
    extracted = load<u8>(byte);
    // Parse the number to a binary string
    binaryString += intToBinString(extracted);
    // If the string length is multiple of the bit size then parse the current string
    // Note that we do not parse everything to string and then to binary
    // This is to avoid storing an extremly large string which is very unefficient
    bitsToProcess = usize(binaryString.length);
    if (bitsToProcess % bitSize === 0) {
      bit = 0;
      while (bit < bitsToProcess) {
        currentBitString = binaryString.slice(bit, bit + bitSize);
        currentValue = u8(parseInt(currentBitString, 2));
        // DANI: OJO, esto funciona porque el output ahora mismo mide 1 byte
        // DANI: El outputByte debería incrementar tanto como el output bytes per element
        store<u8>(outputByte++, numberToASCII(currentValue));
        bit += bitSize;
      }
      binaryString = '';
    }
    byte++;
  }
  // Last byte is also processed apart since the last bits may be discarded
  extracted = load<u8>(byte);
  const spareBits = bitEnd % 8 === 0 ? 0 : (8 - (bitEnd % 8));
  binaryString = intToBinString(extracted);
  binaryString = binaryString.substring(0, binaryString.length - spareBits);
  bitsToProcess = usize(binaryString.length);
  bit = 0;
  while (bit < bitsToProcess) {
    currentBitString = binaryString.slice(bit, bit + bitSize);
    currentValue = u8(parseInt(currentBitString, 2));
    // DANI: OJO, esto funciona porque el output ahora mismo mide 1 byte
    // DANI: El outputByte debería incrementar tanto como el output bytes per element
    store<u8>(outputByte++, numberToASCII(currentValue));
    bit += bitSize;
  }
}