const knownDomains = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'protonmail.com',
  'aol.com',
  'mail.com',
  'yandex.com',
];

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

function getDidYouMean(email) {
  if (typeof email !== 'string' || !email.includes('@')) return null;

  const atIndex = email.lastIndexOf('@');
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1).toLowerCase();

  let bestMatch = null;
  let bestDist = Infinity;

  for (const known of knownDomains) {
    if (domain === known) return null;
    const dist = levenshtein(domain, known);
    if (dist <= 2 && dist < bestDist) {
      bestDist = dist;
      bestMatch = known;
    }
  }

  return bestMatch ? `${local}@${bestMatch}` : null;
}

module.exports = { getDidYouMean, levenshtein };
