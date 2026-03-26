const dns = require('dns');
const net = require('net');
const { getDidYouMean } = require('./getDidYouMean');

// basic regex check — not perfect but catches obvious junk
function isValidSyntax(email) {
  if (typeof email !== 'string') return false;
  if (email.length > 254) return false;

  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  if (!re.test(email)) return false;

  const local = email.split('@')[0];
  if (local.includes('..')) return false;

  return true;
}

function getMxRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) return reject(err);
      const sorted = addresses
        .sort((a, b) => a.priority - b.priority)
        .map((a) => a.exchange);
      resolve(sorted);
    });
  });
}

function smtpCheck(host, email, timeout = 10000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;

    const done = (resultcode, result, subresult, error = null) => {
      socket.destroy();
      resolve({ resultcode, result, subresult, error });
    };

    socket.setTimeout(timeout);

    socket.on('timeout', () => {
      done(3, 'unknown', 'connection_timeout', 'SMTP connection timed out');
    });

    socket.on('error', (err) => {
      done(3, 'unknown', 'connection_error', err.message);
    });

    socket.on('data', (data) => {
      const response = data.toString();
      const code = parseInt(response.slice(0, 3), 10);

      if (step === 0) {
        if (code === 220) {
          step = 1;
          socket.write('EHLO verify.local\r\n');
        } else {
          done(3, 'unknown', 'connection_error', `Unexpected banner: ${response.trim()}`);
        }
      } else if (step === 1) {
        if (code === 250) {
          step = 2;
          socket.write('MAIL FROM:<verify@verify.local>\r\n');
        } else {
          done(3, 'unknown', 'connection_error', `EHLO failed: ${response.trim()}`);
        }
      } else if (step === 2) {
        if (code === 250) {
          step = 3;
          socket.write(`RCPT TO:<${email}>\r\n`);
        } else {
          done(3, 'unknown', 'connection_error', `MAIL FROM failed: ${response.trim()}`);
        }
      } else if (step === 3) {
        if (code === 250 || code === 251) {
          done(1, 'valid', 'mailbox_exists');
        } else if (code === 550 || code === 551 || code === 553) {
          done(6, 'invalid', 'mailbox_does_not_exist', response.trim());
        } else if (code === 450 || code === 451 || code === 452) {
          done(3, 'unknown', 'greylisted', response.trim());
        } else {
          done(3, 'unknown', 'smtp_error', response.trim());
        }
      }
    });

    socket.connect(25, host);
  });
}

async function verifyEmail(email) {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  const base = {
    email,
    result: 'unknown',
    resultcode: 3,
    subresult: 'unknown',
    domain: null,
    mxRecords: [],
    executiontime: 0,
    error: null,
    didyoumean: null,
    timestamp,
  };

  const finish = (overrides) => ({
    ...base,
    ...overrides,
    executiontime: parseFloat(((Date.now() - start) / 1000).toFixed(2)),
  });

  if (email == null || typeof email !== 'string') {
    return finish({ result: 'invalid', resultcode: 6, subresult: 'invalid_syntax', error: 'Email must be a non-null string' });
  }

  if (!isValidSyntax(email)) {
    const suggestion = getDidYouMean(email);
    return finish({
      result: 'invalid',
      resultcode: 6,
      subresult: suggestion ? 'typo_detected' : 'invalid_syntax',
      didyoumean: suggestion,
      error: 'Invalid email syntax',
    });
  }

  const domain = email.split('@')[1].toLowerCase();
  base.domain = domain;

  const suggestion = getDidYouMean(email);
  if (suggestion) {
    return finish({
      result: 'invalid',
      resultcode: 6,
      subresult: 'typo_detected',
      domain,
      didyoumean: suggestion,
      error: 'Possible typo in domain',
    });
  }

  let mxRecords;
  try {
    mxRecords = await getMxRecords(domain);
    base.mxRecords = mxRecords;
  } catch (err) {
    return finish({
      result: 'invalid',
      resultcode: 6,
      subresult: 'no_mx_records',
      domain,
      error: err.message,
    });
  }

  const smtpResult = await smtpCheck(mxRecords[0], email);

  return finish({
    result: smtpResult.result,
    resultcode: smtpResult.resultcode,
    subresult: smtpResult.subresult,
    domain,
    mxRecords,
    error: smtpResult.error,
  });
}

module.exports = { verifyEmail, isValidSyntax, getMxRecords, smtpCheck };
