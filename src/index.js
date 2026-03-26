'use strict';

if (require.main === module) {
  // If run directly (e.g. `node src/index.js`), start the server
  require('./server');
} else {
  // If required as a library, export the functions
  const { verifyEmail } = require('./verifyEmail');
  const { getDidYouMean } = require('./getDidYouMean');
  module.exports = { verifyEmail, getDidYouMean };
}
