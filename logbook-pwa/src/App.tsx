import { useState, useEffect } from 'react'
import type { AuthState } from './lib/auth'
import { checkRecordingSupport } from './lib/auth'
import './App.css'

type AppView = 'auth' | 'timeline' | 'issue-picker'

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [view, setView] = useState<AppView>('auth')
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)

  useEffect(() => {
    const { supported, message } = checkRecordingSupport()
    if (!supported) setRecordingNotice(message)
  }, [])

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
        <button className="btn btn--ghost" onClick={() => setView('issue-picker')}>
          Issues
        </button>
        <span className="app-pubkey">{auth.pubkey.slice(0, 8)}…</span>
      </header>
      {view === 'timeline' && <TimelinePlaceholder auth={auth} />}
      {view === 'issue-picker' && (
        <IssuePickerPlaceholder onSelect={() => setView('timeline')} />
      )}
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
      <h1 className="auth-title">Logbook</h1>
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
            Your key is held in memory only and never stored. Prefer Bunker or Amber.
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

// ─── Placeholder components (replaced in Phase 2/3) ──────────────────────────

function TimelinePlaceholder({ auth }: { auth: AuthState }) {
  return (
    <main className="timeline-placeholder">
      <p>Timeline — Phase 2 (coming soon)</p>
      <p className="muted">Logged in as {auth.pubkey.slice(0, 16)}… via {auth.method}</p>
    </main>
  )
}

function IssuePickerPlaceholder({ onSelect }: { onSelect: () => void }) {
  return (
    <main className="timeline-placeholder">
      <p>Issue Picker — Phase 3 (coming soon)</p>
      <button className="btn btn--ghost" onClick={onSelect}>Back</button>
    </main>
  )
}
