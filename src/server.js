'use strict';

const express = require('express');
const cors = require('cors');
const { verifyEmail } = require('./verifyEmail');
const { getDidYouMean } = require('./getDidYouMean');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow frontend origin (or all origins in dev)
const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
  })
);

app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── POST /api/verify ─────────────────────────────────────────────────────────
// Body: { "email": "user@example.com" }
app.post('/api/verify', async (req, res) => {
  const { email } = req.body;

  if (email === undefined || email === null) {
    return res.status(400).json({ error: 'Missing "email" in request body.' });
  }

  try {
    const result = await verifyEmail(email);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ─── GET /api/suggest?email=... ───────────────────────────────────────────────
app.get('/api/suggest', (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Missing "email" query parameter.' });
  }

  const suggestion = getDidYouMean(email);
  res.json({ email, suggestion });
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`warewe API running on http://localhost:${PORT}`);
});

module.exports = app;
