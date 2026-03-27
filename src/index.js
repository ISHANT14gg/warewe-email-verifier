'use strict';

if (require.main === module) {
  require('./server');
} else {
  const { verifyEmail } = require('./verifyEmail');
  const { getDidYouMean } = require('./getDidYouMean');
  module.exports = { verifyEmail, getDidYouMean };
}
