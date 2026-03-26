import { useState } from 'react'
import './index.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const ICONS = { valid: '✅', invalid: '❌', unknown: '⚠️' }
const BADGE_CLASS = { valid: 'badge-valid', invalid: 'badge-invalid', unknown: 'badge-unknown' }
const RESULT_LABEL = { valid: 'Valid', invalid: 'Invalid', unknown: 'Unknown' }

function ResultCard({ data }) {
  const result = data.result || 'unknown'
  const badgeCls = BADGE_CLASS[result] || BADGE_CLASS.unknown

  const details = [
    { key: 'Subresult',       val: data.subresult || '—' },
    { key: 'Domain',          val: data.domain    || '—' },
    { key: 'Execution Time',  val: data.executiontime != null ? `${data.executiontime}s` : '—' },
    { key: 'Timestamp',       val: data.timestamp ? new Date(data.timestamp).toLocaleString() : '—' },
  ]

  return (
    <div className="result-card">
      <div className="result-header">
        <span className={`status-badge ${badgeCls}`}>
          {ICONS[result]} {RESULT_LABEL[result]}
        </span>
        <span className="result-email">
          Checked: <strong>{data.email}</strong>
        </span>
      </div>

      <div className="detail-grid">
        {details.map(({ key, val }) => (
          <div className="detail-item" key={key}>
            <div className="detail-key">{key}</div>
            <div className="detail-val">{val}</div>
          </div>
        ))}

        {/* MX Records — spans full width if present */}
        {data.mxRecords && data.mxRecords.length > 0 && (
          <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
            <div className="detail-key">MX Records</div>
            <div className="detail-val mx-list">
              {data.mxRecords.map((mx) => (
                <span className="mx-chip" key={mx}>{mx}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {data.error && (
        <div className="error-note">⚡ {data.error}</div>
      )}
    </div>
  )
}

export default function App() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)

  async function handleVerify(e) {
    e.preventDefault()
    if (!email.trim()) return

    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res  = await fetch(`${API_URL}/api/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Server error')
      setResult(data)
    } catch (err) {
      setError(err.message || 'Could not reach the API. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  function applySuggestion() {
    setEmail(result.didyoumean)
    setResult(null)
    setError(null)
  }

  const showSuggestion = result?.didyoumean && result.didyoumean !== email

  return (
    <>
      {/* Ambient background orbs */}
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />

      <main className="app">
        {/* Hero */}
        <header className="hero">
          <div className="logo-wrap">
            <div className="logo-icon">📬</div>
            <span className="logo-text">warewe</span>
          </div>
          <p className="hero-tagline">
            Verify any email address via DNS&nbsp;MX lookup &amp; SMTP handshake —
            with smart typo correction built&nbsp;in.
          </p>
        </header>

        {/* Main card */}
        <section className="card">
          <form onSubmit={handleVerify}>
            <label className="input-label" htmlFor="email-input">Email Address</label>
            <div className="input-row">
              <input
                id="email-input"
                className="email-input"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                spellCheck="false"
                disabled={loading}
                required
              />
              <button
                id="verify-btn"
                className="verify-btn"
                type="submit"
                disabled={loading || !email.trim()}
              >
                {loading
                  ? <><span className="spinner" /> Checking…</>
                  : '→ Verify'}
              </button>
            </div>
          </form>

          {/* Results area */}
          {(result || error) && (
            <>
              <div className="divider" />

              {error && (
                <div className="error-note">⚡ {error}</div>
              )}

              {result && (
                <>
                  {showSuggestion && (
                    <div className="suggestion-banner">
                      <span className="suggestion-text">
                        Did you mean <span>{result.didyoumean}</span>?
                      </span>
                      <button
                        id="use-suggestion-btn"
                        className="use-suggestion-btn"
                        onClick={applySuggestion}
                      >
                        Use this →
                      </button>
                    </div>
                  )}
                  <ResultCard data={result} />
                </>
              )}
            </>
          )}

          {!result && !error && !loading && (
            <>
              <div className="divider" />
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <p className="empty-text">Enter an email above and hit Verify</p>
              </div>
            </>
          )}
        </section>

        {/* Footer */}
        <footer className="footer">
          <p>
            Powered by Node.js · No external runtime deps ·&nbsp;
            <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
          </p>
        </footer>
      </main>
    </>
  )
}
