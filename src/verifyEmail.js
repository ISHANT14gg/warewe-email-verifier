'use strict';

const dns = require('dns');
const net = require('net');
const { getDidYouMean } = require('./getDidYouMean');

// basic syntax check before we bother hitting the network
function isValidSyntax(email) {
  if (email == null || typeof email !== 'string') return false;
  if (email.length === 0 || email.length > 254) return false;

  const atIndex = email.indexOf('@');
  if (atIndex === -1 || atIndex !== email.lastIndexOf('@')) return false;

  const local  = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  if (local.length === 0  || local.length > 64)  return false;
  if (domain.length === 0 || domain.length > 253) return false;

  // no leading/trailing/double dots in local part
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (local.includes('..')) return false;

  // domain needs at least one dot, and a TLD that's 2+ chars
  const parts = domain.split('.');
  if (parts.length < 2) return false;
  if (parts[parts.length - 1].length < 2) return false;

  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

// look up MX records and sort them by priority
function getMxRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) return reject(err);
      const sorted = [...addresses]
        .sort((a, b) => a.priority - b.priority)
        .map(r => r.exchange);
      resolve(sorted);
    });
  });
}

// open an SMTP connection and probe RCPT TO to see if the mailbox is real
function smtpCheck(host, email, port = 25, timeout = 10000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;
    let settled = false;

    const done = (resultcode, result, subresult, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ resultcode, result, subresult, error });
    };

    socket.setTimeout(timeout);

    socket.on('timeout', () =>
      done(3, 'unknown', 'connection_timeout', 'SMTP connection timed out')
    );

    socket.on('error', (err) => {
      const sub = err.code === 'ETIMEDOUT' ? 'connection_timeout' : 'connection_error';
      done(3, 'unknown', sub, err.message);
    });

    socket.on('data', (buf) => {
      const response = buf.toString();
      const code = parseInt(response.trim().slice(0, 3), 10);

      if (step === 0) {
        if (code === 220) {
          step = 1;
          socket.write('EHLO verify.local\r\n');
        } else {
          done(3, 'unknown', 'connection_error', `unexpected banner: ${response.trim()}`);
        }

      } else if (step === 1) {
        if (response.includes('250 ') || response.match(/^250 /m)) {
          step = 2;
          socket.write('MAIL FROM:<verify@verify.local>\r\n');
        } else if (code !== 250) {
          done(3, 'unknown', 'connection_error', `EHLO rejected: ${response.trim()}`);
        }

      } else if (step === 2) {
        if (code === 250) {
          step = 3;
          socket.write(`RCPT TO:<${email}>\r\n`);
        } else {
          done(3, 'unknown', 'connection_error', `MAIL FROM rejected: ${code}`);
        }

      } else if (step === 3) {
        if (code === 250 || code === 251) {
          done(1, 'valid', 'mailbox_exists');
        } else if (code >= 550 && code <= 553) {
          done(6, 'invalid', 'mailbox_does_not_exist', response.trim());
        } else if (code === 450 || code === 451 || code === 452) {
          done(3, 'unknown', 'greylisted', response.trim());
        } else if (code === 421) {
          done(3, 'unknown', 'smtp_error', `service unavailable: ${response.trim()}`);
        } else {
          done(3, 'unknown', 'smtp_error', response.trim());
        }
      }
    });

    socket.connect(port, host);
  });
}

async function verifyEmail(email) {
  const start     = Date.now();
  const timestamp = new Date().toISOString();

  const finish = (fields) => ({
    email,
    result:        fields.result        ?? 'unknown',
    resultcode:    fields.resultcode    ?? 3,
    subresult:     fields.subresult     ?? 'unknown',
    domain:        fields.domain        ?? null,
    mxRecords:     fields.mxRecords     ?? [],
    executiontime: parseFloat(((Date.now() - start) / 1000).toFixed(2)),
    error:         fields.error         ?? null,
    didyoumean:    fields.didyoumean    ?? null,
    timestamp,
  });

  if (email == null || typeof email !== 'string') {
    return finish({
      result: 'invalid', resultcode: 6, subresult: 'invalid_syntax',
      error: 'email must be a non-null string',
    });
  }

  if (!isValidSyntax(email)) {
    const suggestion = getDidYouMean(email);
    return finish({
      result: 'invalid', resultcode: 6,
      subresult: suggestion ? 'typo_detected' : 'invalid_syntax',
      didyoumean: suggestion,
      error: 'invalid email syntax',
    });
  }

  const domain = email.split('@')[1].toLowerCase();

  const suggestion = getDidYouMean(email);
  if (suggestion) {
    return finish({
      result: 'invalid', resultcode: 6, subresult: 'typo_detected',
      domain, didyoumean: suggestion, error: 'possible typo in domain',
    });
  }

  let mxRecords;
  try {
    mxRecords = await getMxRecords(domain);
  } catch (err) {
    return finish({
      result: 'invalid', resultcode: 6, subresult: 'no_mx_records',
      domain, mxRecords: [],
      error: `DNS lookup failed: ${err.message}`,
    });
  }

  if (!mxRecords || mxRecords.length === 0) {
    return finish({
      result: 'invalid', resultcode: 6, subresult: 'no_mx_records',
      domain, mxRecords: [],
      error: 'no MX records found for domain',
    });
  }

  // try port 25 first, fall back to 587 if blocked
  let smtpResult = await smtpCheck(mxRecords[0], email, 25);

  if (smtpResult.subresult === 'connection_error' ||
      smtpResult.subresult === 'connection_timeout') {
    smtpResult = await smtpCheck(mxRecords[0], email, 587);
  }

  // both ports blocked (typical on cloud VMs and behind firewalls)
  if (smtpResult.subresult === 'connection_error' ||
      smtpResult.subresult === 'connection_timeout') {
    return finish({
      result: 'unknown', resultcode: 3, subresult: 'smtp_unavailable',
      domain, mxRecords,
      error: 'MX records found but SMTP port 25/587 is unreachable',
    });
  }

  return finish({
    result:     smtpResult.result,
    resultcode: smtpResult.resultcode,
    subresult:  smtpResult.subresult,
    domain,
    mxRecords,
    error:      smtpResult.error,
  });
}

module.exports = { verifyEmail, isValidSyntax, getMxRecords, smtpCheck };
