// Allows playing with the console output
const readline = require('readline');

// Show in console all log messages in an ordered manner
const logs = [];
const updateLogs = (id, message) => {
  // Set/Update the message
  logs[id] = message;
  // For each message
  for (const i in logs) {
    // Creare a new line
    process.stdout.write('\n');
    // Set the cursor at the begining of the line (in the x axis)
    readline.cursorTo(process.stdout, 0);
    // Remove text form this line ( removes the '[server:watch ]')
    readline.clearLine(process.stdout);
    // Write the message
    process.stdout.write(logs[i]);
  }
  // Set the cursor at the begining of the messages (in both x and y axes)
  readline.cursorTo(process.stdout, 0);
  readline.moveCursor(process.stdout, 0, -logs.length);
};

// Display in console all sockets (connections) and their current status
// Display in console all requests and their current status
// DANI: Esto habría que ponerlo en otro script y que se pudiese reclamar desde el .env
let currentId = 0;
const tracker = instance => {
  instance.on('request', request => {
    const id = currentId;
    currentId += 1;
    const url = request.originalUrl.replace('/rest/current/', '');
    const socket = request.socket ? request.socket.number : 'NULL';
    updateLogs(id, 'REQ (S-' + socket + ') ' + url + '  -->  ACTIVE');
    request.on('aborted', () =>
      updateLogs(id, 'REQ (S-' + socket + ') ' + url + '  -->  ABORTED'),
    );
    request.on('close', () =>
      updateLogs(id, 'REQ (S-' + socket + ') ' + url + '  -->  CLOSED'),
    );
  });
  let currentSocketNumber = 0;
  instance.on('connection', socket => {
    const id = currentId;
    currentId += 1;
    socket.number = currentSocketNumber;
    currentSocketNumber += 1;
    updateLogs(id, 'SOCKET-' + socket.number + '  -->  ACTIVE');
    socket.on('drain', () =>
      updateLogs(id, 'SOCKET ' + socket.number + '  -->  DRAIN'),
    );
    socket.on('close', problem => {
      if (problem)
        updateLogs(id, 'SOCKET-' + socket.number + '  -->  WRONG CLOSED');
      else updateLogs(id, 'SOCKET-' + socket.number + '  -->  CLOSED');
    });
    socket.on('end', () =>
      updateLogs(id, 'SOCKET-' + socket.number + '  -->  END'),
    );
    socket.on('error', () =>
      updateLogs(id, 'SOCKET-' + socket.number + '  -->  ERROR'),
    );
    socket.on('timeout', () =>
      updateLogs(id, 'SOCKET-' + socket.number + '  -->  TIMEOUT'),
    );
  });
};

const dotenvLoad = require('dotenv').config();

if (dotenvLoad.error) throw dotenvLoad.error;

const server = require('./src/server');
// const dbConnectionPromise = require('./src/models');

const main = async () => {
  let serverInstance;
  // let dbConnection;
  try {
    // dbConnection = await dbConnectionPromise;
    serverInstance = server.start();
    // Get console feedback of each API connection and request
    //tracker(serverInstance);
  } catch (error) {
    console.error(error);
    if (serverInstance) server.stop();
  } finally {
    // if (dbConnection && 'close' in dbConnection) dbConnection.close();
  }
};

main();
