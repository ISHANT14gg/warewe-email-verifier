# warewe — Email Verification Module

Verifies email addresses by checking syntax, doing a DNS MX lookup, and then connecting to the SMTP server to see if the mailbox actually exists.

Also detects common domain typos like `gmial.com` and suggests corrections using Levenshtein distance.

No external runtime dependencies for the core module — just Node.js built-ins.

---

## Project Structure

```
warewe/
├── src/
│   ├── server.js        ← Express API server
│   ├── verifyEmail.js   ← Core verification logic
│   ├── getDidYouMean.js ← Typo detection
│   └── index.js         ← Module exports
├── frontend/            ← React (Vite) web UI
├── tests/               ← Jest test suite
├── Procfile             ← Render.com process definition
└── render.yaml          ← Render.com IaC config
```

---

## API Endpoints

### `POST /api/verify`
Verify an email address end-to-end.

**Body:** `{ "email": "user@example.com" }`

**Response:**
```json
{
  "email": "user@example.com",
  "result": "valid",
  "resultcode": 1,
  "subresult": "mailbox_exists",
  "domain": "example.com",
  "mxRecords": ["mx1.example.com"],
  "executiontime": 1.23,
  "error": null,
  "didyoumean": null,
  "timestamp": "2026-02-11T10:30:00.000Z"
}
```

`resultcode` values: `1` = valid, `3` = unknown, `6` = invalid

### `GET /api/suggest?email=user@gmial.com`
Returns a typo correction suggestion only.

### `GET /health`
Health check — returns `{ status: "ok" }`.

---

## Running Locally

### Backend
```bash
npm install
cp .env.example .env
npm start          # → http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env    # set VITE_API_URL=http://localhost:3001
npm run dev             # → http://localhost:5173
```

---

## Tests

```bash
npm test           # runs Jest test suite with coverage
```

---

## Deploying

### Backend → [Render.com](https://render.com)

1. Push this repo to GitHub
2. Go to Render → **New Web Service** → connect your repo
3. Render auto-detects `render.yaml` — click **Apply**
4. After deploy, copy the service URL (e.g. `https://warewe-api.onrender.com`)
5. Set the `FRONTEND_URL` environment variable in Render to your Vercel URL

### Frontend → [Vercel](https://vercel.com)

1. Go to Vercel → **New Project** → import your repo
2. Set **Root Directory** to `frontend`
3. Add environment variable: `VITE_API_URL` = your Render backend URL
4. Click **Deploy**

---

## Module Usage (direct)

```js
const { verifyEmail, getDidYouMean } = require('./src/index');

const result = await verifyEmail('user@gmail.com');
console.log(result);

// typo check only
getDidYouMean('user@gmial.com'); // → 'user@gmail.com'
```
