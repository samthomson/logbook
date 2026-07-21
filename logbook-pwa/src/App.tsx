import { useState, useEffect } from 'react'
import type { AuthState } from './lib/auth'
import { useKeyboardOffset } from './lib/useKeyboardOffset'

import IssueTimeline from './components/IssueTimeline'
import IssuePicker from './components/IssuePicker'
import InstallPrompt from './components/InstallPrompt'
import { fetchLatestIssue, parseIssue } from './lib/compass'
import { checkRecordingSupport } from './lib/utils'
import { IOS_RECORDING_MIN_VERSION } from './config'
import { fetchWhitelist, isWhitelisted as checkWhitelist } from './lib/whitelist'
import type { CompassIssue, NostrEvent } from './types/nostr'
import './App.css'

type AppView = 'auth' | 'timeline' | 'issue-picker'

const SESSION_KEY = 'logbook_auth'

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [view, setView] = useState<AppView>('auth')
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  const [issue, setIssue] = useState<CompassIssue | null>(null)
  const [isWhitelisted, setIsWhitelisted] = useState(false)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const keyboardOffset = useKeyboardOffset()

  useEffect(() => {
    const { supported, message } = checkRecordingSupport(IOS_RECORDING_MIN_VERSION)
    if (!supported) setRecordingNotice(message)
  }, [])

  // Expose keyboard offset as a CSS var so sticky actions float above the keyboard
  useEffect(() => {
    document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`)
  }, [keyboardOffset])

  // Restore session on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (!saved) return
    try {
      const { method, input, passphrase } = JSON.parse(saved) as {
        method: string; input?: string; passphrase?: string
      }
      if (method === 'extension' && typeof window !== 'undefined' && 'nostr' in window) {
        import('./lib/auth').then(({ connectWindowNostr }) =>
          connectWindowNostr().then((state) => { setAuth(state); setView('timeline') }).catch(() => {})
        )
      } else if ((method === 'nsec' || method === 'bunker') && input) {
        import('./lib/auth').then(async ({ connectNsec, connectBunker }) => {
          try {
            const state = method === 'nsec'
              ? await connectNsec(input, passphrase)
              : await connectBunker(input)
            setAuth(state)
            setView('timeline')
          } catch { /* session expired or invalid — just show auth screen */ }
        })
      }
    } catch { /* corrupt storage */ }
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
        setIsWhitelisted(checkWhitelist(auth.pubkey, wl))
      })
      .catch((err: unknown) => {
        setIssueError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setIssueLoading(false))
  }, [auth])

  const handleSelectIssue = async (event: NostrEvent) => {
    if (!auth) return
    setIssueLoading(true)
    setIssueError(null)
    try {
      const parsed = parseIssue(event)
      setIssue(parsed)
      const issueId = `logbook-${parsed.issueNumber}`
      const wl = await fetchWhitelist(issueId)
      setIsWhitelisted(checkWhitelist(auth.pubkey, wl))
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
        <AuthScreen onAuth={(state, method, input, passphrase) => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ method, input, passphrase }))
        setAuth(state)
        setView('timeline')
      }} />
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

      <InstallPrompt />

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
            currentIssueNumber={issue?.issueNumber ?? null}
            onSelect={handleSelectIssue}
            onBack={() => setView('timeline')}
          />
        )}
      </div>
    </div>
  )
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }: {
  onAuth: (state: AuthState, method: string, input?: string, passphrase?: string) => void
}) {
  const [mode, setMode] = useState<'bunker' | 'extension' | 'nsec' | null>(null)
  const [input, setInput] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const hasExtension = typeof window !== 'undefined' && 'nostr' in window
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

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
      onAuth(state, mode, input || undefined, passphrase || undefined)
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
          onClick={async () => {
            if (hasExtension) {
              // Already injected — connect immediately, no extra click needed
              setMode('extension')
              setError(null)
              setLoading(true)
              try {
                const { connectWindowNostr } = await import('./lib/auth')
                const state = await connectWindowNostr()
                onAuth(state, 'extension')
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              } finally {
                setLoading(false)
              }
            } else {
              setMode('extension')
            }
          }}
        >
          {hasExtension ? 'Amber / Extension' : isAndroid ? 'Open in Amber' : 'Amber / Extension'}
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

      {mode === 'extension' && !hasExtension && (
        <div className="auth-form">
          {isAndroid ? (
            <>
              <p className="auth-warning">
                Open this page inside Amber's built-in browser to sign in with one tap.
              </p>
              <a
                className="btn btn--primary"
                href={`nostrsigner:${encodeURIComponent(window.location.href)}?compressionType=none&returnType=signature&type=get_public_key`}
              >
                Open in Amber
              </a>
            </>
          ) : (
            <p className="auth-warning">
              Install a NIP-07 browser extension (e.g. Alby, nos2x) or open this page inside Amber on Android.
            </p>
          )}
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}

      {mode && (
        <button
          className="btn btn--primary sticky-action"
          onClick={handleConnect}
          disabled={loading || (mode !== 'extension' && !input.trim()) || (mode === 'extension' && !hasExtension)}
        >
          {loading ? 'Connecting…' : 'Connect'}
        </button>
      )}
    </div>
  )
}
