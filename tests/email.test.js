/**
 * Email Verification Module — Test Suite
 *
 * Covers:
 *  - Syntax validation (isValidSyntax)
 *  - Typo detection (getDidYouMean + Levenshtein)
 *  - DNS failures
 *  - SMTP response codes: 250, 550, 450, connection_error, timeout
 *  - Edge cases: null, undefined, empty, very long, multiple @
 *  - Result object shape
 *
 * Run: npm test
 */

jest.mock('dns');
jest.mock('net');

const dns = require('dns');
const net = require('net');
const { verifyEmail, isValidSyntax, smtpCheck } = require('../src/verifyEmail');
const { getDidYouMean, levenshtein } = require('../src/getDidYouMean');

// ─── Mock socket factory ───────────────────────────────────────────────────────
/**
 * Creates a mock net.Socket that emits SMTP responses in sequence.
 * On connect():
 *   - If `timeout` is true  → emits 'timeout' immediately
 *   - If `connectError` set → emits 'error' with that message
 *   - Otherwise             → emits first response as the SMTP banner
 *
 * On write():
 *   - Emits the next response from the queue
 */
function createMockSocket({ responses = [], connectError = null, timeout = false } = {}) {
  const EventEmitter = require('events');
  const socket = new EventEmitter();

  socket.setTimeout = jest.fn();
  socket.destroy    = jest.fn();

  socket.write = jest.fn(() => {
    const reply = responses.shift();
    if (reply) setImmediate(() => socket.emit('data', Buffer.from(reply)));
  });

  socket.connect = jest.fn(() => {
    if (timeout) {
      setImmediate(() => socket.emit('timeout'));
    } else if (connectError) {
      const err = new Error(connectError);
      err.code = connectError;
      setImmediate(() => socket.emit('error', err));
    } else {
      const banner = responses.shift();
      if (banner) setImmediate(() => socket.emit('data', Buffer.from(banner)));
    }
  });

  return socket;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Part 1: Syntax validation ─────────────────────────────────────────────────
describe('isValidSyntax() — valid formats', () => {
  test('simple valid email passes', () => {
    expect(isValidSyntax('user@example.com')).toBe(true);
  });

  test('email with dots in local part passes', () => {
    expect(isValidSyntax('first.last@domain.co.uk')).toBe(true);
  });

  test('email with plus sign passes', () => {
    expect(isValidSyntax('user+tag@example.org')).toBe(true);
  });

  test('subdomain email passes', () => {
    expect(isValidSyntax('hello@mail.example.com')).toBe(true);
  });
});

describe('isValidSyntax() — invalid formats', () => {
  test('missing @ is rejected', () => {
    expect(isValidSyntax('userdomain.com')).toBe(false);
  });

  test('multiple @ symbols are rejected', () => {
    expect(isValidSyntax('a@b@c.com')).toBe(false);
  });

  test('double dots in local part are rejected', () => {
    expect(isValidSyntax('user..name@gmail.com')).toBe(false);
  });

  test('leading dot in local part is rejected', () => {
    expect(isValidSyntax('.user@example.com')).toBe(false);
  });

  test('empty string is rejected', () => {
    expect(isValidSyntax('')).toBe(false);
  });

  test('null returns false', () => {
    expect(isValidSyntax(null)).toBe(false);
  });

  test('undefined returns false', () => {
    expect(isValidSyntax(undefined)).toBe(false);
  });

  test('email over 254 characters is rejected', () => {
    const longEmail = 'a'.repeat(250) + '@b.com'; // 256 chars
    expect(isValidSyntax(longEmail)).toBe(false);
  });

  test('missing domain is rejected', () => {
    expect(isValidSyntax('user@')).toBe(false);
  });

  test('domain without TLD is rejected', () => {
    expect(isValidSyntax('user@example')).toBe(false);
  });
});

// ─── Part 2: Typo detection ────────────────────────────────────────────────────
describe('getDidYouMean() — typo suggestions', () => {
  test('gmial.com → gmail.com', () => {
    expect(getDidYouMean('user@gmial.com')).toBe('user@gmail.com');
  });

  test('yahooo.com → yahoo.com', () => {
    expect(getDidYouMean('user@yahooo.com')).toBe('user@yahoo.com');
  });

  test('hotmial.com → hotmail.com', () => {
    expect(getDidYouMean('user@hotmial.com')).toBe('user@hotmail.com');
  });

  test('outlok.com → outlook.com', () => {
    expect(getDidYouMean('user@outlok.com')).toBe('user@outlook.com');
  });

  test('correct domain returns null', () => {
    expect(getDidYouMean('user@gmail.com')).toBeNull();
  });

  test('no @ in string returns null', () => {
    expect(getDidYouMean('notanemail')).toBeNull();
  });
});

describe('levenshtein() — edit distance', () => {
  test('identical strings → distance 0', () => {
    expect(levenshtein('gmail.com', 'gmail.com')).toBe(0);
  });

  test('gmial.com vs gmail.com → distance 2 (swap g/m + m/a)', () => {
    expect(levenshtein('gmial.com', 'gmail.com')).toBeLessThanOrEqual(2);
  });

  test('completely different strings → distance > 2', () => {
    expect(levenshtein('xyz.com', 'gmail.com')).toBeGreaterThan(2);
  });
});

// ─── Part 3: verifyEmail — edge cases (no network needed) ─────────────────────
describe('verifyEmail() — edge cases', () => {
  test('null email → invalid / invalid_syntax', async () => {
    const r = await verifyEmail(null);
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('invalid_syntax');
    expect(r.resultcode).toBe(6);
  });

  test('undefined email → invalid / invalid_syntax', async () => {
    const r = await verifyEmail(undefined);
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('invalid_syntax');
  });

  test('empty string → invalid / invalid_syntax', async () => {
    const r = await verifyEmail('');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('invalid_syntax');
  });

  test('very long email (> 254 chars) → invalid / invalid_syntax', async () => {
    const r = await verifyEmail('a'.repeat(250) + '@b.com');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('invalid_syntax');
  });

  test('multiple @ symbols → invalid / invalid_syntax', async () => {
    const r = await verifyEmail('a@b@c.com');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('invalid_syntax');
  });

  test('typo domain → invalid / typo_detected', async () => {
    const r = await verifyEmail('user@gmial.com');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('typo_detected');
    expect(r.didyoumean).toBe('user@gmail.com');
  });
});

// ─── Part 4: DNS failures ──────────────────────────────────────────────────────
describe('verifyEmail() — DNS failures', () => {
  test('ENOTFOUND → invalid / no_mx_records', async () => {
    dns.resolveMx.mockImplementation((_domain, cb) => {
      cb(new Error('ENOTFOUND'), null);
    });
    const r = await verifyEmail('user@thisdoesnotexist99999.com');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('no_mx_records');
    expect(r.resultcode).toBe(6);
    expect(r.mxRecords).toEqual([]);
  });
});

// ─── Part 5: SMTP response codes ──────────────────────────────────────────────
describe('verifyEmail() — SMTP codes (mocked)', () => {
  /** Sets up dns.resolveMx to return a fake MX record */
  function setupMx() {
    dns.resolveMx.mockImplementation((_domain, cb) => {
      cb(null, [{ exchange: 'mx.example.com', priority: 10 }]);
    });
  }

  test('SMTP 250 → valid / mailbox_exists', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',   // EHLO
          '250 OK\r\n',   // MAIL FROM
          '250 OK\r\n',   // RCPT TO — mailbox exists
        ],
      })
    );
    const r = await verifyEmail('user@example.com');
    expect(r.result).toBe('valid');
    expect(r.subresult).toBe('mailbox_exists');
    expect(r.resultcode).toBe(1);
    expect(r.mxRecords).toContain('mx.example.com');
  });

  test('SMTP 550 → invalid / mailbox_does_not_exist', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '550 5.1.1 User unknown\r\n',  // RCPT TO — no such mailbox
        ],
      })
    );
    const r = await verifyEmail('nobody@example.com');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('mailbox_does_not_exist');
    expect(r.resultcode).toBe(6);
  });

  test('SMTP 551 → invalid / mailbox_does_not_exist', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '551 User not local\r\n',
        ],
      })
    );
    const r = await verifyEmail('nobody@example.com');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('mailbox_does_not_exist');
  });

  test('SMTP 450 → unknown / greylisted', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '450 Greylisted, please try again later\r\n',
        ],
      })
    );
    const r = await verifyEmail('user@example.com');
    expect(r.result).toBe('unknown');
    expect(r.subresult).toBe('greylisted');
    expect(r.resultcode).toBe(3);
  });

  test('SMTP 451 → unknown / greylisted', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '451 Temporary failure\r\n',
        ],
      })
    );
    const r = await verifyEmail('user@example.com');
    expect(r.result).toBe('unknown');
    expect(r.subresult).toBe('greylisted');
  });

  test('connection timeout on both ports → unknown / smtp_unavailable', async () => {
    setupMx();
    net.Socket.mockImplementation(() => createMockSocket({ timeout: true }));
    const r = await verifyEmail('user@example.com');
    expect(r.result).toBe('unknown');
    expect(r.subresult).toBe('smtp_unavailable');
    expect(r.resultcode).toBe(3);
  });

  test('connection refused on both ports → unknown / smtp_unavailable', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({ connectError: 'ECONNREFUSED' })
    );
    const r = await verifyEmail('user@example.com');
    expect(r.result).toBe('unknown');
    expect(r.subresult).toBe('smtp_unavailable');
  });
});

// ─── Part 6: smtpCheck unit tests ─────────────────────────────────────────────
describe('smtpCheck() — direct unit tests', () => {
  test('250 RCPT TO response → valid / mailbox_exists', async () => {
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 ready\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '250 2.1.5 OK\r\n',
        ],
      })
    );
    const r = await smtpCheck('mx.example.com', 'a@example.com');
    expect(r.result).toBe('valid');
    expect(r.subresult).toBe('mailbox_exists');
  });

  test('550 RCPT TO response → invalid / mailbox_does_not_exist', async () => {
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 ready\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '550 no such user\r\n',
        ],
      })
    );
    const r = await smtpCheck('mx.example.com', 'x@example.com');
    expect(r.result).toBe('invalid');
    expect(r.subresult).toBe('mailbox_does_not_exist');
  });

  test('timeout → unknown / connection_timeout', async () => {
    net.Socket.mockImplementation(() => createMockSocket({ timeout: true }));
    const r = await smtpCheck('mx.example.com', 'a@example.com');
    expect(r.result).toBe('unknown');
    expect(r.subresult).toBe('connection_timeout');
  });

  test('connection error → unknown / connection_error', async () => {
    net.Socket.mockImplementation(() =>
      createMockSocket({ connectError: 'ECONNREFUSED' })
    );
    const r = await smtpCheck('mx.example.com', 'a@example.com');
    expect(r.result).toBe('unknown');
    expect(r.subresult).toBe('connection_error');
  });
});

// ─── Part 7: Result object shape ──────────────────────────────────────────────
describe('verifyEmail() — result object shape', () => {
  const REQUIRED_FIELDS = [
    'email', 'result', 'resultcode', 'subresult',
    'domain', 'mxRecords', 'executiontime', 'error', 'didyoumean', 'timestamp',
  ];

  test('result always contains all required fields', async () => {
    const r = await verifyEmail('bad-email');
    REQUIRED_FIELDS.forEach((key) => expect(r).toHaveProperty(key));
  });

  test('executiontime is a non-negative number', async () => {
    const r = await verifyEmail('bad-email');
    expect(typeof r.executiontime).toBe('number');
    expect(r.executiontime).toBeGreaterThanOrEqual(0);
  });

  test('timestamp is a valid ISO 8601 string', async () => {
    const r = await verifyEmail('bad-email');
    expect(new Date(r.timestamp).toISOString()).toBe(r.timestamp);
  });

  test('mxRecords is always an array', async () => {
    const r = await verifyEmail('bad-email');
    expect(Array.isArray(r.mxRecords)).toBe(true);
  });

  test('resultcode is 1, 3, or 6', async () => {
    const r = await verifyEmail('bad-email');
    expect([1, 3, 6]).toContain(r.resultcode);
  });
});
