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
  // Optional stream with the simulation box in .bin format (9 float32 per frame)
  boxStream,
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
  // If there is a box then the fourth argument tells the executable to read it from the file descriptor 3
  if (boxStream) args.push('box');

  // Run the conversor process
  // An additional pipe is opened as file descriptor 3 to pass the box
  const stdio = boxStream ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'];
  const spawnedProcess = spawn(executablePath, args, { stdio });

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
  // Pipe the box stream to the process, if any
  if (boxStream) {
    boxStream.pipe(spawnedProcess.stdio[3]).on('error', () => {
      boxStream.destroy();
    });
    // Also destroy the box stream when the process is over (e.g. user cancels the download)
    spawnedProcess.on('close', () => boxStream.destroy());
  }

  return spawnedProcess.stdout;
};

module.exports = chemfilesConverter;
