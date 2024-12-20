// This script is not in JavaScript, but in AssemblyScript
// This code needs to be compiled when updated. Use "sudo npm run build"
// This is used to conver binary float32 data from the database to human readable numbers format
// The entry file of your WebAssembly module.

// To debug this script use the function 'trace' instead of 'console.log'

// Experimentally observed
// 33 = !
// 34 = "
// 35 = #
// 36 = $
// 37 = %
// 38 = &
// 39 = '
// 40 = (
// 41 = )
// 42 = *
// 43 = +
// 44 = ,
// 45 = -
// 46 = .
// 47 = /
// 48 = 0
// 49 = 1
// 50 = 2
// 51 = 3
// 52 = 4
// 53 = 5
// 54 = 6
// 55 = 7
// 56 = 8
// 57 = 9
// 58 = :
// 59 = ;
// 60 = <
// 61 = =
// 62 = >
// 63 = ?
// 64 = @
// 65 = A
// 66 = B
// 67 = C
// 68 = D
// 69 = E
// 70 = F
// 71 = G
// 72 = H
// 73 = I
// 74 = J
// 75 = K
// 76 = L
// 77 = M
// 78 = N
// 79 = O
// 80 = P
// 81 = Q
// 82 = R
// 83 = S
// 84 = T
// 85 = U
// 86 = V
// 87 = W
// 88 = X
// 89 = Y
// 90 = Z
// 91 = [
// 92 = \
// 93 = ]
// 94 = ^
// 95 = _
// 96 = `
// 97 = a
// 98 = b
// 99 = c
// 100 = d
// 101 = e
// 102 = f
// 103 = g
// 104 = h
// 105 = i
// 106 = j
// 107 = k
// 108 = l
// 109 = m
// 110 = n
// 111 = o
// 112 = p
// 113 = q
// 114 = r
// 115 = s
// 116 = t
// 117 = u
// 118 = v
// 119 = w
// 120 = x
// 121 = y
// 122 = z
// 123 = {
// 124 = |
// 125 = }
// 126 = ~

// Set a function convert numbers to their equivalent u8 string character
const numberToASCII = (n: u8): u8 => n + 48;

// Set constants for some u8 string characters
const SPACE = u8(32);
const DOT = u8(46);
const PLUS = u8(43);
const MINUS = u8(45);
const EXP = u8(101);

// Set the number of decimals
const DECIMALS = usize(6);
// Set the number of spaces before the NaN string when value is NaN
// It is the number of decimals + dot + first digit + symbol + white space
const NANWS = DECIMALS + 4;
// Store 10
const TEN = usize(10);

export function transform(inputOffset: usize, nValues: usize, outputOffset: usize) : void {
    let outputIndex = outputOffset;
    for (let i = usize(0); i < nValues; i++) {
        // Read data from input part of the memory
        const offset = inputOffset + (i * 4);
        const value = load<f32>(offset);
        // If the value is NaN then only write NaN
        if (isNaN(value)) {
            for (let s = usize(0); s <= NANWS; s++) store<u8>(outputIndex++, SPACE);
            store<u8>(outputIndex++, u8(78)); // N
            store<u8>(outputIndex++, u8(97)); // a
            store<u8>(outputIndex++, u8(78)); // N
            continue
        }
        // Get the exponent of the float (log base 10 of the absolute value)
        const exponent = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
        // Get the mantissa of the float by scaling the value
        // Remove the negative sign to avoid further problems when converting digits to u8
        const mantissa = value === 0 ? 0 : Math.abs(value / Math.pow(TEN, exponent));
        // Get the sign
        const sign = Math.sign(value);
        // Add a space at the very begining
        store<u8>(outputIndex++, SPACE);
        // Now add the minus symbol if it is negative
        // Otherwise add another space
        if (sign === -1) store<u8>(outputIndex++, MINUS);
        else store<u8>(outputIndex++, SPACE);
        // Write the first digit
        // Note that converting a float to u8 simply truncates the number to its integer as long as it fits in u8
        // Note that the mantissa will never be negative or this would not work since u8 range is 0-255
        const firstDigit = u8(mantissa);
        store<u8>(outputIndex++, numberToASCII(firstDigit));
        // Write the second digit, which will always be a DOT
        store<u8>(outputIndex++, DOT);
        // Set a mantissa to be reduced in digits along the following iteration
        let previousMantissa = mantissa;
        // Then write as many decimals as specified
        for (let d = usize(0); d < DECIMALS; d++) {
            const spare = Math.trunc(previousMantissa) * TEN;
            // Update the mantissa
            previousMantissa = previousMantissa * TEN - spare;
            const digit = u8(previousMantissa);
            store<u8>(outputIndex++, numberToASCII(digit));
        }
        // Write the 'e' letter for the exponent
        store<u8>(outputIndex++, EXP);
        // Get the exponent sign
        const exponentSign = Math.sign(exponent);
        if (exponentSign === -1) store<u8>(outputIndex++, MINUS);
        else store<u8>(outputIndex++, PLUS);
        // Write the exponent digits
        // Note that according to the float 32 limitations the exponent should never be grater than 38
        const firstExponentDigit = u8(Math.trunc(exponent / TEN));
        store<u8>(outputIndex++, numberToASCII(firstExponentDigit));
        const secondExponentDigit = u8(exponent - firstExponentDigit * TEN);
        store<u8>(outputIndex++, numberToASCII(secondExponentDigit));
    }
}
