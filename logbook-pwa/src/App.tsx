import { useState, useEffect, useRef } from 'react'
import type { AuthState } from './lib/auth'
import { startAmberConnect } from './lib/auth'
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
      const { method, input, passphrase, session } = JSON.parse(saved) as {
        method: string; input?: string; passphrase?: string; session?: string
      }
      if (method === 'extension' && typeof window !== 'undefined' && 'nostr' in window) {
        import('./lib/auth').then(({ connectWindowNostr }) =>
          connectWindowNostr().then((state) => { setAuth(state); setView('timeline') }).catch(() => {})
        )
      } else if ((method === 'amber' || method === 'bunker') && session) {
        import('./lib/auth').then(async ({ restoreSession }) => {
          try {
            const state = await restoreSession(session, method as 'amber' | 'bunker')
            setAuth(state)
            setView('timeline')
          } catch { /* session expired or invalid — just show auth screen */ }
        })
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
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ method, input, passphrase, session: state.session }))
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
        <button
          className="btn btn--ghost btn--small app-logout"
          onClick={() => {
            sessionStorage.removeItem(SESSION_KEY)
            setAuth(null)
            setIssue(null)
            setView('auth')
          }}
          aria-label="Log out"
        >
          Log out
        </button>
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
            myPubkey={auth.pubkey}
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
  const [advanced, setAdvanced] = useState<'bunker' | 'nsec' | null>(null)
  const [input, setInput] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null) // which method is connecting
  const [amberWaiting, setAmberWaiting] = useState(false)
  const amberCancelRef = useRef<(() => void) | null>(null)
  const hasExtension = typeof window !== 'undefined' && 'nostr' in window
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

  // Cancel any pending Amber connection on unmount
  useEffect(() => () => { amberCancelRef.current?.() }, [])

  function handleAmber() {
    // Everything before the navigation must be synchronous — Android Chrome
    // blocks scheme navigations that aren't tied directly to the user gesture.
    setError(null)
    try {
      const handle = startAmberConnect()
      amberCancelRef.current = handle.cancel
      setAmberWaiting(true)
      handle.wait()
        .then((state) => { amberCancelRef.current = null; onAuth(state, 'amber') })
        .catch((err) => {
          setAmberWaiting(false)
          if (!(err instanceof Error && err.message === 'Aborted')) {
            setError(err instanceof Error ? err.message : String(err))
          }
        })
      window.location.href = handle.uri // synchronous deep link into Amber
    } catch (err) {
      setAmberWaiting(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExtension() {
    setError(null)
    setLoading('extension')
    try {
      const { connectWindowNostr } = await import('./lib/auth')
      const state = await connectWindowNostr()
      onAuth(state, 'extension')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(null)
    }
  }

  async function handleAdvancedConnect() {
    setError(null)
    setLoading(advanced)
    try {
      let state: AuthState
      if (advanced === 'bunker') {
        const { connectBunker } = await import('./lib/auth')
        state = await connectBunker(input.trim())
      } else if (advanced === 'nsec') {
        const { connectNsec } = await import('./lib/auth')
        state = await connectNsec(input.trim(), passphrase || undefined)
      } else {
        return
      }
      onAuth(state, advanced, input || undefined, passphrase || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="auth-screen auth-screen--compact">
      <div className="auth-logo">
        <div className="auth-logo__mark" aria-hidden="true">📻</div>
        <h1 className="auth-title">Logbook</h1>
      </div>
      <p className="auth-subtitle">Async voice podcast for Nostr Compass</p>

      <div className="auth-methods">
        {isAndroid && (
          amberWaiting ? (
            <div className="auth-waiting" role="status">
              <div className="spinner spinner--small" aria-hidden="true" />
              <span>Approve in Amber…</span>
              <button
                className="btn btn--ghost btn--small"
                onClick={() => {
                  amberCancelRef.current?.()
                  amberCancelRef.current = null
                  setAmberWaiting(false)
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn--primary auth-primary" onClick={handleAmber}>
              Sign in with Amber
            </button>
          )
        )}

        {hasExtension && (
          <button
            className={`btn ${isAndroid ? 'btn--ghost' : 'btn--primary auth-primary'}`}
            onClick={handleExtension}
            disabled={loading === 'extension'}
          >
            {loading === 'extension' ? 'Connecting…' : 'Sign in with extension'}
          </button>
        )}

        {!isAndroid && !hasExtension && (
          <p className="auth-hint">
            On Android? Install <a href="https://github.com/greenart7c3/Amber" target="_blank" rel="noreferrer">Amber</a> for
            one-tap sign-in. On desktop, use a NIP-07 extension (Alby, nos2x) or the advanced options below.
          </p>
        )}

        <button
          className="auth-toggle"
          onClick={() => setAdvanced(advanced ? null : 'bunker')}
          aria-expanded={advanced !== null}
        >
          {advanced ? 'Hide advanced options' : 'Advanced options'}
        </button>
      </div>

      {advanced && (
        <div className="auth-form">
          <div className="auth-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={advanced === 'bunker'}
              className={`auth-tab ${advanced === 'bunker' ? 'auth-tab--active' : ''}`}
              onClick={() => { setAdvanced('bunker'); setInput(''); setError(null) }}
            >
              Bunker (NIP-46)
            </button>
            <button
              role="tab"
              aria-selected={advanced === 'nsec'}
              className={`auth-tab ${advanced === 'nsec' ? 'auth-tab--active' : ''}`}
              onClick={() => { setAdvanced('nsec'); setInput(''); setError(null) }}
            >
              nsec
            </button>
          </div>

          {advanced === 'bunker' && (
            <input
              className="auth-input"
              type="text"
              placeholder="bunker://..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          )}

          {advanced === 'nsec' && (
            <>
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
                Key held in memory only — never stored. Prefer Amber or Bunker.
              </p>
            </>
          )}

          <button
            className="btn btn--primary"
            onClick={handleAdvancedConnect}
            disabled={loading !== null || !input.trim()}
          >
            {loading === advanced ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}
    </div>
  )
}
