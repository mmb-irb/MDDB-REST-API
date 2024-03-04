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

// Store the global output memory byte to be written next
let outputByte = usize(0);

// Store the string representation of the input binary
let binaryString = '';
// Store the current bit we are iterating in the parsing function
let bit = usize(0);
// Store the limit bit to be processed in the parsing function
let bitsToProcess = usize(0);
// Store the string representation of the current bits to be parsed
let currentBitsString = '';
// Store the current value of the already parsed bits
let currentValue = u8(0);

// Parse and store a binary string in the output memory as unsigned numeric values
// If the string length is multiple of the bit size then parse the string
// Otherwise do nothing
const parseAndStoreBinString = (bitSize: usize): void => {
  bit = usize(0);
  bitsToProcess = usize(binaryString.length);
  // Stop here if the length of the binary string is not multiple of the bit size
  if (bitsToProcess % bitSize !== 0) return;
  while (bit < bitsToProcess) {
    // Pica a fragment of the string as long as the bit size and then parse it
    currentBitsString = binaryString.slice(bit, bit + bitSize);
    currentValue = u8(parseInt(currentBitsString, 2));
    // DANI: OJO, esto funciona porque el output ahora mismo mide 1 byte
    // DANI: El outputByte debería incrementar tanto como el output bytes per element
    store<u8>(outputByte++, numberToASCII(currentValue));
    bit += bitSize;
  }
  binaryString = '';
};

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
  // Set the next output memory byte to be written
  // This number is then updated by the parsing function
  outputByte = outputStart;
  // For divisions to make sense we must add one the to the end bit
  const lastBit = bitEnd + 1;
  // Process the first byte independently since first bits may be discarded
  let byte = byteStart;
  // Read the selected binary range and parse it to string
  let extracted = load<u8>(byte);
  binaryString = intToBinString(extracted).substring(bitStart);
  // In case the fragment is one byte long we must process the end and exit here
  if (byteStart === byteEnd) {
    const spareBits = lastBit % 8 === 0 ? 0 : (8 - (lastBit % 8));
    binaryString = binaryString.substring(0, binaryString.length - spareBits);
    parseAndStoreBinString(bitSize);
    return;
  }
  byte++;
  // Now iterate over the rest of bytes
  while (byte < byteEnd) {
    //if (byte % 10000 === 0) trace(byte.toString() + '/' + byteEnd.toString() + '\r');
    // Read data from input part of the memory
    extracted = load<u8>(byte);
    // Parse the number to a binary string
    binaryString += intToBinString(extracted);
    // If the string length is multiple of the bit size then parse the current string
    // Note that we do not parse everything to string and then to binary
    // This is to avoid storing an extremly large string which is very unefficient
    parseAndStoreBinString(bitSize);
    byte++;
  }
  // Last byte is also processed apart since the last bits may be discarded
  extracted = load<u8>(byte);
  binaryString = intToBinString(extracted);
  // Calculate how many bits we must substract from the end and take them out of the binary string
  const spareBits = lastBit % 8 === 0 ? 0 : (8 - (lastBit % 8));
  binaryString = binaryString.substring(0, binaryString.length - spareBits);
  parseAndStoreBinString(bitSize);
}