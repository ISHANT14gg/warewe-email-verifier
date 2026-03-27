'use strict';

const dns = require('dns');
const net = require('net');
const { getDidYouMean } = require('./getDidYouMean');

// ─── Domains known to block SMTP RCPT TO probing (catch-all / privacy guard) ──
const CATCH_ALL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.fr', 'yahoo.de',
  'yahoo.es', 'yahoo.it', 'yahoo.com.au', 'yahoo.com.br', 'yahoo.ca',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it',
  'hotmail.es', 'hotmail.com.au',
  'outlook.com', 'live.com', 'msn.com', 'live.co.uk',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'tutanota.com', 'tuta.io',
  'aol.com', 'aim.com', 'ymail.com',
  'zoho.com', 'zohomail.com',
  'fastmail.com', 'fastmail.fm',
  'mail.com', 'email.com',
  'gmx.com', 'gmx.net', 'gmx.de',
  'web.de', 'freenet.de', 'arcor.de', 't-online.de',
  'libero.it', 'tiscali.it', 'virgilio.it',
  'orange.fr', 'sfr.fr', 'free.fr', 'laposte.net',
  'wanadoo.es', 'terra.es',
  'rediffmail.com', 'indiatimes.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'list.ru', 'inbox.ru', 'bk.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'foxmail.com',
]);

// ─── Syntax check ─────────────────────────────────────────────────────────────
function isValidSyntax(email) {
  if (typeof email !== 'string') return false;
  if (email.length > 254) return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  if (!re.test(email)) return false;
  const local = email.split('@')[0];
  if (local.includes('..')) return false;
  return true;
}

// ─── Local MX lookup ──────────────────────────────────────────────────────────
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

// ─── Raw TCP SMTP check (works on VPS, blocked on Render/Vercel) ──────────────
function smtpCheck(host, email, port = 25, timeout = 10000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;

    const done = (resultcode, result, subresult, error = null) => {
      socket.destroy();
      resolve({ resultcode, result, subresult, error });
    };

    socket.setTimeout(timeout);
    socket.on('timeout', () => done(3, 'unknown', 'connection_timeout', 'SMTP connection timed out'));
    socket.on('error', (err) => done(3, 'unknown', 'connection_error', err.message));

    socket.on('data', (data) => {
      const response = data.toString();
      const code = parseInt(response.slice(0, 3), 10);

      if (step === 0) {
        if (code === 220) { step = 1; socket.write('EHLO verify.local\r\n'); }
        else done(3, 'unknown', 'connection_error', `Unexpected banner: ${response.trim()}`);
      } else if (step === 1) {
        if (code === 250) { step = 2; socket.write('MAIL FROM:<verify@verify.local>\r\n'); }
        else done(3, 'unknown', 'connection_error', `EHLO failed: ${response.trim()}`);
      } else if (step === 2) {
        if (code === 250) { step = 3; socket.write(`RCPT TO:<${email}>\r\n`); }
        else done(3, 'unknown', 'connection_error', `MAIL FROM failed: ${response.trim()}`);
      } else if (step === 3) {
        if (code === 250 || code === 251)                      done(1, 'valid',   'mailbox_exists');
        else if (code >= 550 && code <= 553)                    done(6, 'invalid', 'mailbox_does_not_exist', response.trim());
        else if (code === 450 || code === 451 || code === 452) done(3, 'unknown', 'greylisted', response.trim());
        else                                                    done(3, 'unknown', 'smtp_error', response.trim());
      }
    });

    socket.connect(port, host);
  });
}

// ─── Abstract API (if ABSTRACT_API_KEY is set in env) ────────────────────────
async function abstractApiCheck(email) {
  const apiKey = process.env.ABSTRACT_API_KEY;
  if (!apiKey) return null;

  const url = `https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    return { error: err.message };
  }

  const d = (data.deliverability || 'UNKNOWN').toUpperCase();
  let result, resultcode, subresult;
  if (d === 'DELIVERABLE')      { result = 'valid';   resultcode = 1; subresult = 'mailbox_exists'; }
  else if (d === 'UNDELIVERABLE') { result = 'invalid'; resultcode = 6; subresult = 'mailbox_does_not_exist'; }
  else if (d === 'RISKY')       { result = 'unknown'; resultcode = 3; subresult = 'risky_mailbox'; }
  else                          { result = 'unknown'; resultcode = 3; subresult = 'smtp_inconclusive'; }

  return {
    result, resultcode, subresult,
    isDisposable:   data.is_disposable_email?.value  ?? false,
    isFreeProvider: data.is_free_email_host?.value   ?? false,
    qualityScore:   data.quality_score               ?? null,
    mxRecords:      Array.isArray(data.mx_records) ? data.mx_records : [],
    autocorrect:    data.autocorrect || null,
  };
}

// ─── mailcheck.ai (free, no API key, domain-level validation) ─────────────────
// Returns { mx, disposable, mxRecords, domainAge } or null on failure.
async function mailcheckAiCheck(email) {
  const encoded = encodeURIComponent(email);
  const url = `https://api.mailcheck.ai/email/${encoded}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      hasMx:       !!data.mx,
      disposable:  !!data.disposable,
      roleAccount: !!data.role_account,
      spam:        !!data.spam,
      domainAge:   data.domain_age_in_days ?? null,
      mxRecords:   Array.isArray(data.mx_records)
        ? data.mx_records.map((r) => r.hostname)
        : [],
      didYouMean:  data.did_you_mean || null,
    };
  } catch {
    return null;
  }
}

// ─── Main verifyEmail ─────────────────────────────────────────────────────────
async function verifyEmail(email) {
  const start     = Date.now();
  const timestamp = new Date().toISOString();

  const base = {
    email,
    result:         'unknown',
    resultcode:     3,
    subresult:      'unknown',
    domain:         null,
    mxRecords:      [],
    isDisposable:   false,
    isFreeProvider: false,
    qualityScore:   null,
    executiontime:  0,
    error:          null,
    didyoumean:     null,
    timestamp,
  };

  const finish = (overrides) => ({
    ...base,
    ...overrides,
    executiontime: parseFloat(((Date.now() - start) / 1000).toFixed(2)),
  });

  // ── 1. Null / type guard ──────────────────────────────────────────────────
  if (email == null || typeof email !== 'string') {
    return finish({ result: 'invalid', resultcode: 6, subresult: 'invalid_syntax',
                    error: 'Email must be a non-null string' });
  }

  // ── 2. Syntax ─────────────────────────────────────────────────────────────
  if (!isValidSyntax(email)) {
    const suggestion = getDidYouMean(email);
    return finish({
      result: 'invalid', resultcode: 6,
      subresult: suggestion ? 'typo_detected' : 'invalid_syntax',
      didyoumean: suggestion,
      error: 'Invalid email syntax',
    });
  }

  const domain = email.split('@')[1].toLowerCase();
  base.domain = domain;

  // ── 3. Typo / did-you-mean ────────────────────────────────────────────────
  const localSuggestion = getDidYouMean(email);
  if (localSuggestion) {
    return finish({
      result: 'invalid', resultcode: 6, subresult: 'typo_detected',
      domain, didyoumean: localSuggestion, error: 'Possible typo in domain',
    });
  }

  // ── 4. Abstract API (real SMTP, best accuracy, optional key) ─────────────
  const apiResult = await abstractApiCheck(email);
  if (apiResult && !apiResult.error) {
    return finish({
      result:         apiResult.result,
      resultcode:     apiResult.resultcode,
      subresult:      apiResult.subresult,
      domain,
      mxRecords:      apiResult.mxRecords,
      isDisposable:   apiResult.isDisposable,
      isFreeProvider: apiResult.isFreeProvider,
      qualityScore:   apiResult.qualityScore,
      didyoumean:     apiResult.autocorrect || null,
    });
  }

  // ── 5. mailcheck.ai (free, no key — domain-level: MX + disposable) ────────
  const mc = await mailcheckAiCheck(email);

  if (mc) {
    base.mxRecords      = mc.mxRecords;
    base.isDisposable   = mc.disposable;
    base.isFreeProvider = CATCH_ALL_DOMAINS.has(domain);

    // Hard failures that don't need SMTP
    if (!mc.hasMx) {
      return finish({ result: 'invalid', resultcode: 6, subresult: 'no_mx_records',
                      domain, mxRecords: mc.mxRecords,
                      error: 'Domain has no MX records' });
    }
    if (mc.disposable) {
      return finish({ result: 'invalid', resultcode: 6, subresult: 'disposable_email',
                      domain, mxRecords: mc.mxRecords,
                      error: 'Disposable / temporary email address' });
    }
    if (mc.spam) {
      return finish({ result: 'invalid', resultcode: 6, subresult: 'known_spam_domain',
                      domain, mxRecords: mc.mxRecords,
                      error: 'Domain is flagged as spam' });
    }

    // Catch-all domains (Gmail, Yahoo, Outlook, etc.) block SMTP probing.
    // We know the DOMAIN is valid — return domain_valid (honest & useful).
    if (CATCH_ALL_DOMAINS.has(domain)) {
      return finish({
        result: 'valid', resultcode: 1, subresult: 'domain_valid',
        domain, mxRecords: mc.mxRecords,
        isDisposable:   false,
        isFreeProvider: true,
        error: null,
      });
    }

    // For non-catch-all domains with MX records, try raw SMTP ────────────────
    let mxList = mc.mxRecords;

    // Also attempt SMTP on port 587 → 25
    let smtpResult = await smtpCheck(mxList[0], email, 587);
    if (smtpResult.subresult === 'connection_error' || smtpResult.subresult === 'connection_timeout') {
      smtpResult = await smtpCheck(mxList[0], email, 25);
    }

    if (smtpResult.subresult === 'connection_error' || smtpResult.subresult === 'connection_timeout') {
      // Both ports blocked (cloud host). MX exists → treat as domain_valid.
      return finish({
        result: 'valid', resultcode: 1, subresult: 'domain_valid',
        domain, mxRecords: mxList,
        error: 'SMTP ports blocked by host; domain-level validation passed',
      });
    }

    return finish({
      result:     smtpResult.result,
      resultcode: smtpResult.resultcode,
      subresult:  smtpResult.subresult,
      domain,
      mxRecords:  mxList,
      error:      smtpResult.error,
    });
  }

  // ── 6. Last resort: local DNS MX + raw SMTP ───────────────────────────────
  let mxRecords;
  try {
    mxRecords = await getMxRecords(domain);
    base.mxRecords = mxRecords;
  } catch (err) {
    return finish({ result: 'invalid', resultcode: 6, subresult: 'no_mx_records',
                    domain, error: err.message });
  }

  if (CATCH_ALL_DOMAINS.has(domain)) {
    return finish({
      result: 'valid', resultcode: 1, subresult: 'domain_valid',
      domain, mxRecords,
      isFreeProvider: true,
    });
  }

  let smtpResult = await smtpCheck(mxRecords[0], email, 587);
  if (smtpResult.subresult === 'connection_error' || smtpResult.subresult === 'connection_timeout') {
    smtpResult = await smtpCheck(mxRecords[0], email, 25);
  }

  if (smtpResult.subresult === 'connection_error' || smtpResult.subresult === 'connection_timeout') {
    return finish({
      result: 'valid', resultcode: 1, subresult: 'domain_valid',
      domain, mxRecords,
      error: 'SMTP ports blocked; domain-level validation passed',
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

module.exports = { verifyEmail, isValidSyntax, getMxRecords, smtpCheck, abstractApiCheck, mailcheckAiCheck };
