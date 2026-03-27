jest.mock('dns');
jest.mock('net');

const dns = require('dns');
const net = require('net');
const { verifyEmail, isValidSyntax } = require('../src/verifyEmail');
const { getDidYouMean, levenshtein } = require('../src/getDidYouMean');

function createMockSocket({ responses = [], connectError = null, timeout = false } = {}) {
  const EventEmitter = require('events');
  const socket = new EventEmitter();

  socket.setTimeout = jest.fn();
  socket.destroy = jest.fn();

  socket.write = jest.fn(() => {
    const reply = responses.shift();
    if (reply) setImmediate(() => socket.emit('data', Buffer.from(reply)));
  });

  socket.connect = jest.fn(() => {
    if (timeout) {
      setImmediate(() => socket.emit('timeout'));
    } else if (connectError) {
      setImmediate(() => socket.emit('error', new Error(connectError)));
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

// --- syntax checks ---

describe('isValidSyntax()', () => {
  test('valid email passes', () => {
    expect(isValidSyntax('user@example.com')).toBe(true);
  });

  test('email with dots in local part passes', () => {
    expect(isValidSyntax('first.last@domain.co.uk')).toBe(true);
  });

  test('missing @ is rejected', () => {
    expect(isValidSyntax('userdomain.com')).toBe(false);
  });

  test('multiple @ symbols are rejected', () => {
    expect(isValidSyntax('a@b@c.com')).toBe(false);
  });

  test('double dots in local part are rejected', () => {
    expect(isValidSyntax('user..name@gmail.com')).toBe(false);
  });

  test('empty string returns false', () => {
    expect(isValidSyntax('')).toBe(false);
  });

  test('null returns false', () => {
    expect(isValidSyntax(null)).toBe(false);
  });

  test('undefined returns false', () => {
    expect(isValidSyntax(undefined)).toBe(false);
  });

  test('email over 254 chars is rejected', () => {
    const longEmail = 'a'.repeat(250) + '@b.com';
    expect(isValidSyntax(longEmail)).toBe(false);
  });
});

// --- typo detection ---

describe('getDidYouMean()', () => {
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

  test('no @ sign returns null', () => {
    expect(getDidYouMean('notanemail')).toBeNull();
  });
});

describe('levenshtein()', () => {
  test('same strings have distance 0', () => {
    expect(levenshtein('gmail.com', 'gmail.com')).toBe(0);
  });

  test('transposed letters give correct distance', () => {
    expect(levenshtein('gmial.com', 'gmail.com')).toBe(2);
  });
});

// --- verifyEmail with mocked network ---

describe('verifyEmail() edge cases', () => {
  test('null email returns invalid_syntax', async () => {
    const result = await verifyEmail(null);
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe('invalid_syntax');
  });

  test('undefined email returns invalid_syntax', async () => {
    const result = await verifyEmail(undefined);
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe('invalid_syntax');
  });

  test('typo in domain sets typo_detected and didyoumean', async () => {
    const result = await verifyEmail('user@gmial.com');
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe('typo_detected');
    expect(result.didyoumean).toBe('user@gmail.com');
  });
});

describe('verifyEmail() DNS failure', () => {
  test('domain with no MX records returns no_mx_records', async () => {
    dns.resolveMx.mockImplementation((_domain, cb) => {
      cb(new Error('ENOTFOUND'), null);
    });
    const result = await verifyEmail('user@nonexistentdomain12345.com');
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe('no_mx_records');
  });
});

describe('verifyEmail() SMTP codes', () => {
  function setupMx() {
    dns.resolveMx.mockImplementation((_domain, cb) => {
      cb(null, [{ exchange: 'mx.example.com', priority: 10 }]);
    });
  }

  test('SMTP 250 → valid mailbox', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
        ],
      })
    );
    const result = await verifyEmail('user@example.com');
    expect(result.result).toBe('valid');
    expect(result.subresult).toBe('mailbox_exists');
    expect(result.resultcode).toBe(1);
  });

  test('SMTP 550 → mailbox does not exist', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '550 5.1.1 User unknown\r\n',
        ],
      })
    );
    const result = await verifyEmail('noone@example.com');
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe('mailbox_does_not_exist');
    expect(result.resultcode).toBe(6);
  });

  test('SMTP 450 → greylisted', async () => {
    setupMx();
    net.Socket.mockImplementation(() =>
      createMockSocket({
        responses: [
          '220 mx.example.com ESMTP\r\n',
          '250 OK\r\n',
          '250 OK\r\n',
          '450 Greylisted, try again\r\n',
        ],
      })
    );
    const result = await verifyEmail('user@example.com');
    expect(result.result).toBe('unknown');
    expect(result.subresult).toBe('greylisted');
    expect(result.resultcode).toBe(3);
  });

  // The new code tries port 587 → port 25, then mailcheck.ai (fails in test env).
  // When SMTP is blocked but MX exists → domain_valid (honest: domain is real).
  test('connection timeout on both ports → domain_valid', async () => {
    setupMx();
    net.Socket.mockImplementation(() => createMockSocket({ timeout: true }));
    const result = await verifyEmail('user@example.com');
    expect(result.result).toBe('valid');
    expect(result.subresult).toBe('domain_valid');
  });

  // Both 587 and 25 are refused, mailcheck.ai unavailable in test env → domain_valid.
  test('connection refused on both ports → domain_valid', async () => {
    setupMx();
    net.Socket.mockImplementation(() => createMockSocket({ connectError: 'ECONNREFUSED' }));
    const result = await verifyEmail('user@example.com');
    expect(result.result).toBe('valid');
    expect(result.subresult).toBe('domain_valid');
  });
});

// --- result shape ---

describe('verifyEmail() result shape', () => {
  test('result always has all required fields', async () => {
    const result = await verifyEmail('bad-email');
    ['email', 'result', 'resultcode', 'subresult', 'domain', 'mxRecords', 'executiontime', 'error', 'didyoumean', 'timestamp'].forEach((key) => {
      expect(result).toHaveProperty(key);
    });
  });

  test('executiontime is a non-negative number', async () => {
    const result = await verifyEmail('bad-email');
    expect(typeof result.executiontime).toBe('number');
    expect(result.executiontime).toBeGreaterThanOrEqual(0);
  });

  test('timestamp is a valid ISO string', async () => {
    const result = await verifyEmail('bad-email');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
