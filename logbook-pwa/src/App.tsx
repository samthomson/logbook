import { useState, useEffect } from 'react'
import type { AuthState } from './lib/auth'
import { checkRecordingSupport } from './lib/auth'
import IssueTimeline from './components/IssueTimeline'
import IssuePicker from './components/IssuePicker'
import { fetchLatestIssue, fetchIssueByDTag, parseIssue } from './lib/compass'
import { fetchWhitelist } from './lib/whitelist'
import type { CompassIssue, IssueManifest } from './types/nostr'
import './App.css'

type AppView = 'auth' | 'timeline' | 'issue-picker'

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [view, setView] = useState<AppView>('auth')
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  const [issue, setIssue] = useState<CompassIssue | null>(null)
  const [isWhitelisted, setIsWhitelisted] = useState(false)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)

  useEffect(() => {
    const { supported, message } = checkRecordingSupport()
    if (!supported) setRecordingNotice(message)
  }, [])

  // Load latest issue + whitelist check after login
  useEffect(() => {
    if (!auth) return
    setIssueLoading(true)
    setIssueError(null)

    fetchLatestIssue()
      .then(async (event) => {
        if (!event) return
        const parsed = parseIssue(event)
        setIssue(parsed)
        // Check whitelist for this issue
        const issueId = `logbook-${parsed.issueNumber}`
        const wl = await fetchWhitelist(issueId)
        setIsWhitelisted(wl.has(auth.pubkey))
      })
      .catch((err: unknown) => {
        setIssueError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setIssueLoading(false))
  }, [auth])

  const handleSelectIssue = async (manifest: IssueManifest) => {
    if (!auth) return
    setIssueLoading(true)
    setIssueError(null)
    try {
      // Load the actual Compass issue that corresponds to this manifest d-tag
      const event = await fetchIssueByDTag(manifest.issueId) ?? await fetchLatestIssue()
      if (!event) throw new Error('No issue found')
      const parsed = parseIssue(event)
      setIssue(parsed)
      const wl = await fetchWhitelist(manifest.issueId)
      setIsWhitelisted(wl.has(auth.pubkey))
      setView('timeline')
    } catch (err: unknown) {
      setIssueError(err instanceof Error ? err.message : String(err))
    } finally {
      setIssueLoading(false)
    }
  }

  if (view === 'auth' || !auth) {
    return (
      <div className="app">
        {recordingNotice && (
          <div className="notice notice--warning" role="alert">
            {recordingNotice}
          </div>
        )}
        <AuthScreen onAuth={(state) => { setAuth(state); setView('timeline') }} />
      </div>
    )
  }

  return (
    <div className="app">
      {recordingNotice && (
        <div className="notice notice--warning" role="alert">
          {recordingNotice}
        </div>
      )}

      <header className="app-header">
        <span className="app-title">Logbook</span>
        <nav className="app-nav">
          <button
            className={`btn btn--ghost btn--small ${view === 'timeline' ? 'btn--active' : ''}`}
            onClick={() => setView('timeline')}
          >
            Timeline
          </button>
          <button
            className={`btn btn--ghost btn--small ${view === 'issue-picker' ? 'btn--active' : ''}`}
            onClick={() => setView('issue-picker')}
          >
            Episodes
          </button>
        </nav>
        <span className="app-pubkey" title={auth.pubkey}>
          {auth.pubkey.slice(0, 8)}…
        </span>
      </header>

      <div className="app-body">
        {issueLoading && (
          <div className="app-loading">
            <div className="spinner" aria-label="Loading" />
            <p>Loading issue…</p>
          </div>
        )}
        {issueError && (
          <div className="notice notice--error">
            Failed to load issue: {issueError}
          </div>
        )}

        {view === 'timeline' && !issueLoading && issue && (
          <IssueTimeline
            issue={issue}
            signer={auth.signer}
            isWhitelisted={isWhitelisted}
          />
        )}

        {view === 'timeline' && !issueLoading && !issue && !issueError && (
          <div className="app-empty">
            <p>No issues found. Check back soon.</p>
          </div>
        )}

        {view === 'issue-picker' && (
          <IssuePicker
            onSelect={handleSelectIssue}
            onBack={() => setView('timeline')}
          />
        )}
      </div>
    </div>
  )
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }: { onAuth: (state: AuthState) => void }) {
  const [mode, setMode] = useState<'bunker' | 'extension' | 'nsec' | null>(null)
  const [input, setInput] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setError(null)
    setLoading(true)
    try {
      let state: AuthState
      if (mode === 'bunker') {
        const { connectBunker } = await import('./lib/auth')
        state = await connectBunker(input.trim())
      } else if (mode === 'extension') {
        const { connectWindowNostr } = await import('./lib/auth')
        state = await connectWindowNostr()
      } else if (mode === 'nsec') {
        const { connectNsec } = await import('./lib/auth')
        state = await connectNsec(input.trim(), passphrase || undefined)
      } else {
        return
      }
      onAuth(state)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-logo">
        <div className="auth-logo__mark" aria-hidden="true">📻</div>
        <h1 className="auth-title">Logbook</h1>
      </div>
      <p className="auth-subtitle">Async voice podcast for Nostr Compass</p>

      <div className="auth-methods">
        <button
          className={`auth-btn ${mode === 'bunker' ? 'auth-btn--active' : ''}`}
          onClick={() => setMode('bunker')}
        >
          Bunker (NIP-46)
        </button>
        <button
          className={`auth-btn ${mode === 'extension' ? 'auth-btn--active' : ''}`}
          onClick={() => setMode('extension')}
        >
          Amber / Extension
        </button>
        <button
          className={`auth-btn auth-btn--advanced ${mode === 'nsec' ? 'auth-btn--active' : ''}`}
          onClick={() => setMode('nsec')}
        >
          nsec (advanced)
        </button>
      </div>

      {mode === 'bunker' && (
        <div className="auth-form">
          <input
            className="auth-input"
            type="text"
            placeholder="bunker://..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}

      {mode === 'nsec' && (
        <div className="auth-form">
          <input
            className="auth-input"
            type="password"
            placeholder="nsec1... or ncryptsec..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {input.startsWith('ncryptsec') && (
            <input
              className="auth-input"
              type="password"
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          )}
          <p className="auth-warning">
            Key held in memory only — never stored. Prefer Bunker or Amber.
          </p>
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}

      {mode && (
        <button
          className="btn btn--primary"
          onClick={handleConnect}
          disabled={loading || (mode !== 'extension' && !input.trim())}
        >
          {loading ? 'Connecting…' : 'Connect'}
        </button>
      )}
    </div>
  )
}
