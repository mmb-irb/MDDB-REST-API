// This script converts the database stored file (.bin) into several other formats using chemfiles
// This is complex since chemfiles has no node version so we have to use a c++ version previously compiled
// The required executable must be previously compiled with 'sudo npm run build'

// Allows to call a unix command or run another script
// The execution of this code keeps running
const { spawn } = require('child_process');

// File system
const fs = require('fs');

const chemfilesConverter = function(
  inputStream,
  atomCount,
  frameCount,
  outputFormat,
) {
  // "spawn" runs the provided program in an additional process (child process)
  // The expected command here is the call to the chemfiles converter executable

  // Set the path to the executable
  const executablePath = process.cwd() + '/build/chemfiles_bin_converter';
  // Check that the executable exists
  if (!fs.existsSync(executablePath))
    throw new Error('Missing chemfiles executable. Did you forget to compile?');

  // Set the arguments to the executable
  const args = [
    // First argument is the number of atoms
    atomCount.toString(),
    // Second argument is the number of frames
    frameCount.toString(),
    // Third argument is the output format
    outputFormat,
  ];

  // Run the conversor process
  const spawnedProcess = spawn(executablePath, args);

  // Pipe the child errors to the current process errors so we can see if there is any problem
  spawnedProcess.stderr.pipe(process.stderr);

  // Kill the spawned process in case its output stream is close (e.g. user cancels the download)
  spawnedProcess.stdout.on('close', () => {
    spawnedProcess.kill();
  });

  // Pipe the input stream to the process
  // NEVER FORGET: Error must be handled here or it would kill the API
  inputStream.pipe(spawnedProcess.stdin).on('error', () => {
    inputStream.destroy();
  });

  return spawnedProcess.stdout;
};

module.exports = chemfilesConverter;
