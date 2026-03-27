'use strict';

const express = require('express');
const cors = require('cors');
const { verifyEmail } = require('./verifyEmail');
const { getDidYouMean } = require('./getDidYouMean');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(u => u.trim().replace(/\/$/, ''))
  : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    return callback(new Error('origin ' + origin + ' not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
}));

app.options(/.*/, cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.json({
    message: 'warewe email verifier API',
    docs: 'POST /api/verify  |  GET /api/suggest?email=...',
  });
});

app.post('/api/verify', async (req, res) => {
  const { email } = req.body;

  if (email === undefined || email === null) {
    return res.status(400).json({ error: 'missing "email" in request body' });
  }

  try {
    const result = await verifyEmail(email);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'internal server error', details: err.message });
  }
});

app.get('/api/suggest', (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'missing "email" query parameter' });
  }

  res.json({ email, suggestion: getDidYouMean(email) });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`warewe API running on port ${PORT}`);
});

module.exports = app;
