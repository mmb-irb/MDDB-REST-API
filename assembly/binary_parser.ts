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
  // First read the selected binary range and parse it to string
  let byte = byteStart;
  let binaryString = '';
  while (byte <= byteEnd) {
    // Read data from input part of the memory
    const extracted = load<u8>(byte);
    // Parse the number to a binary string
    binaryString += intToBinString(extracted);
    byte++;
  }
  // Now extract values from the string using the specified bit size and start
  let bit = bitStart;
  let outputByte = outputStart;
  while (bit <= bitEnd) {
    const bitString = binaryString.slice(bit, bit + bitSize);
    const value = u8(parseInt(bitString, 2));
    // DANI: OJO, esto funciona porque el output ahora mismo mide 1 byte
    // DANI: El outputByte debería incrementar tanto como el output bytes per element
    store<u8>(outputByte++, numberToASCII(value));
    bit += bitSize;
  }
}