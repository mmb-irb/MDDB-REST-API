//const fetch = require('node-fetch');

// Ping to an URL just for them to know
// Note that we do not await the answer
const ping = url => {
  fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'MDposit' }
  });
}

module.exports = ping;