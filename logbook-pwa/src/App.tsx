import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import type { AuthState } from './lib/auth'
import { connectBunker, connectNsec, connectWindowNostr, restoreSession, startAmberConnect } from './lib/auth'
import { AUTH_SESSION_KEY, readRestorableAuthSession } from './lib/session'
import { useKeyboardOffset } from './lib/useKeyboardOffset'

import IssueTimeline from './components/IssueTimeline'
import IssuePicker from './components/IssuePicker'
import InstallPrompt from './components/InstallPrompt'
const AdminPanel = lazy(() => import('./components/AdminPanel'))
import { fetchLatestIssue, parseIssue } from './lib/compass'
import { checkRecordingSupport } from './lib/utils'
import { IOS_RECORDING_MIN_VERSION } from './config'
import { fetchAccessLists } from './lib/whitelist'
import type { CompassIssue, NostrEvent } from './types/nostr'
import './App.css'

type AppView = 'auth' | 'timeline' | 'issue-picker' | 'admin'

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [view, setView] = useState<AppView>('auth')
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  const [issue, setIssue] = useState<CompassIssue | null>(null)
  const [isWhitelisted, setIsWhitelisted] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [accessDegraded, setAccessDegraded] = useState(false)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const keyboardOffset = useKeyboardOffset()

  /** Single access-control fetch — canRecord + isAdmin derive from the same
   *  call, so the two gates can never race or disagree. */
  const loadAccess = useCallback(async (issueNumber: number, pubkey: string) => {
    try {
      const access = await fetchAccessLists(issueNumber)
      setIsWhitelisted(access.contributors.has(pubkey) || access.admins.has(pubkey))
      setIsAdmin(access.admins.has(pubkey))
      setAccessDegraded(access.degraded)
    } catch {
      // Total failure — fail closed on record, but never lock out bootstrap
      // admins (they need the UI that fixes the list). fetchAccessLists
      // already encodes this; a throw here means something truly unexpected.
      setIsWhitelisted(false)
      setAccessDegraded(true)
    }
  }, [])

  useEffect(() => {
    const { supported, message } = checkRecordingSupport(IOS_RECORDING_MIN_VERSION)
    if (!supported) setRecordingNotice(message)
  }, [])

  // Expose keyboard offset as a CSS var so sticky actions float above the keyboard
  useEffect(() => {
    document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`)
  }, [keyboardOffset])

  // Restore only a revocable NIP-46 session or extension identity on mount.
  useEffect(() => {
    const saved = readRestorableAuthSession(sessionStorage)
    if (!saved) return

    if (saved.method === 'extension' && typeof window !== 'undefined' && 'nostr' in window) {
      connectWindowNostr().then((state) => { setAuth(state); setView('timeline') }).catch(() => {})
    } else if ((saved.method === 'amber' || saved.method === 'bunker') && saved.session) {
      restoreSession(saved.session, saved.method)
        .then((state) => { setAuth(state); setView('timeline') })
        .catch(() => {}) // Session expired or invalid — keep the auth screen.
    }
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
        await loadAccess(parsed.issueNumber, auth.pubkey)
      })
      .catch((err: unknown) => {
        setIssueError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setIssueLoading(false))
  }, [auth, loadAccess])

  const handleSelectIssue = async (event: NostrEvent) => {
    if (!auth) return
    setIssueLoading(true)
    setIssueError(null)
    try {
      const parsed = parseIssue(event)
      setIssue(parsed)
      await loadAccess(parsed.issueNumber, auth.pubkey)
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
        <AuthScreen onAuth={(state, method) => {
        // nsec and bunker URIs can grant direct key access. Keep them in
        // memory only; NIP-46 sessions supply a revocable nbunksec instead.
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ method, session: state.session }))
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
          {isAdmin && (
            <button
              className={`btn btn--ghost btn--small ${view === 'admin' ? 'btn--active' : ''}`}
              onClick={() => setView('admin')}
            >
              Admin
            </button>
          )}
        </nav>
        <button
          className="btn btn--ghost btn--small app-logout"
          onClick={() => {
            sessionStorage.removeItem(AUTH_SESSION_KEY)
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
        {accessDegraded && (
          <div className="notice notice--warning" role="alert">
            Couldn't load the contributor list — recording is paused.
            <button
              className="btn btn--ghost btn--small"
              onClick={() => { if (issue && auth) void loadAccess(issue.issueNumber, auth.pubkey) }}
            >
              Retry
            </button>
          </div>
        )}
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

        {view === 'admin' && isAdmin && issue && (
          <Suspense fallback={<div className="app-empty"><p>Loading admin tools…</p></div>}>
            <AdminPanel
              issue={issue}
              signer={auth.signer}
              pubkey={auth.pubkey}
            />
          </Suspense>
        )}
        {view === 'admin' && isAdmin && !issue && (
          <div className="app-empty">
            <p>Load an episode from the Timeline first.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }: {
  onAuth: (state: AuthState, method: string) => void
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
        state = await connectBunker(input.trim())
      } else if (advanced === 'nsec') {
        state = await connectNsec(input.trim(), passphrase || undefined)
      } else {
        return
      }
      onAuth(state, advanced)
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
