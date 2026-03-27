'use strict';

const express = require('express');
const cors = require('cors');
const { verifyEmail } = require('./verifyEmail');
const { getDidYouMean } = require('./getDidYouMean');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow frontend origin (or all origins in dev)
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(u => u.trim().replace(/\/$/, ''))
  : ['*'];

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes('*')) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // allow any vercel preview deployment
    if (origin.endsWith('.vercel.app')) return callback(null, true);

    return callback(new Error('origin ' + origin + ' not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests


app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Root route ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ message: 'Welcome to the warewe email verifier API!', docs: 'Use POST /api/verify or GET /api/suggest' });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`warewe API running on port ${PORT}`);
});

module.exports = app;
