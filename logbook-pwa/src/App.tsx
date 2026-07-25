import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import type { AuthState } from './lib/auth'
import { connectBunker, connectNsec, connectWindowNostr, restoreSession, startAmberConnect } from './lib/auth'
import { AUTH_SESSION_KEY, readSelectedIssueNumber, restorePersistedAuthSession, saveRestorableAuthSession, saveSelectedIssueNumber } from './lib/session'
import { withSignerTimeout } from './lib/signer-timeout'
import { createLatestRequestGuard, type LatestRequestGuard } from './lib/latest-request'
import { useKeyboardOffset } from './lib/useKeyboardOffset'

import IssueTimeline from './components/IssueTimeline'
import IssuePicker from './components/IssuePicker'
import InstallPrompt from './components/InstallPrompt'
const AdminPanel = lazy(() => import('./components/AdminPanel'))
import { fetchIssueByDTag, fetchLatestIssue, fetchLatestIssueWithSegments, parseIssue } from './lib/compass'
import { checkRecordingSupport } from './lib/utils'
import { ADMIN_PUBKEYS, COMPASS_PUBKEY, IOS_RECORDING_MIN_VERSION } from './config'
import { fetchAccessLists } from './lib/whitelist'
import { loadCachedIssue } from './lib/issue-cache'
import { fetchProfiles, type Profile } from './lib/profiles'
import { nip19 } from 'nostr-tools'
import type { CompassIssue, NostrEvent } from './types/nostr'
import './App.css'

type AppView = 'auth' | 'timeline' | 'issue-picker' | 'admin'

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [restoringAuth, setRestoringAuth] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [view, setView] = useState<AppView>('timeline')
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  const [issue, setIssue] = useState<CompassIssue | null>(null)
  const [isWhitelisted, setIsWhitelisted] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [contributorPubkeys, setContributorPubkeys] = useState<Set<string>>(new Set())
  const [accessDegraded, setAccessDegraded] = useState(false)
  const [issueLoading, setIssueLoading] = useState(true)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [cachedSegments, setCachedSegments] = useState<[string, NostrEvent[]][]>([])
  const [identityProfile, setIdentityProfile] = useState<Profile | null>(null)
  const keyboardOffset = useKeyboardOffset()
  const [issueRequests] = useState(createLatestRequestGuard)
  const [accessRequests] = useState(createLatestRequestGuard)
  const [authRequests] = useState(createLatestRequestGuard)
  const [manifestWriteRequests] = useState(createLatestRequestGuard)
  const [whitelistWriteRequests] = useState(createLatestRequestGuard)
  const [timelineCapabilityRequests] = useState(createLatestRequestGuard)
  const [timelineCapabilityRequest, setTimelineCapabilityRequest] = useState<number | null>(null)
  const [adminCapabilityRequests] = useState(createLatestRequestGuard)
  const [adminCapabilityRequest, setAdminCapabilityRequest] = useState<number | null>(null)

  const clearAccess = useCallback(() => {
    accessRequests.invalidate()
    manifestWriteRequests.invalidate()
    whitelistWriteRequests.invalidate()
    timelineCapabilityRequests.invalidate()
    adminCapabilityRequests.invalidate()
    setTimelineCapabilityRequest(null)
    setAdminCapabilityRequest(null)
    setIsWhitelisted(false)
    setIsAdmin(false)
    setContributorPubkeys(new Set())
    setAccessDegraded(false)
  }, [accessRequests, adminCapabilityRequests, manifestWriteRequests, timelineCapabilityRequests, whitelistWriteRequests])

  /** Single access-control fetch — canRecord + isAdmin derive from the same
   *  call, so the two gates can never race or disagree. */
  const loadAccess = useCallback(async (issueNumber: number, pubkey: string) => {
    timelineCapabilityRequests.invalidate()
    adminCapabilityRequests.invalidate()
    setTimelineCapabilityRequest(null)
    setAdminCapabilityRequest(null)
    const request = accessRequests.begin()
    const isCompass = pubkey.toLowerCase() === COMPASS_PUBKEY.toLowerCase()
    const isBootstrapAdmin = isCompass || ADMIN_PUBKEYS.some((admin) => admin.toLowerCase() === pubkey.toLowerCase())
    try {
      const access = await fetchAccessLists(issueNumber)
      if (!accessRequests.isCurrent(request)) return
      manifestWriteRequests.invalidate()
      whitelistWriteRequests.invalidate()
      // Admin review must use the same merged set that grants recording,
      // including admins who are allowed to contribute without a separate
      // contributor-list entry.
      const allowed = new Set([...access.contributors, ...access.admins])
      allowed.add(COMPASS_PUBKEY)
      const canRecord = isBootstrapAdmin || allowed.has(pubkey.toLowerCase())
      const canAdmin = isBootstrapAdmin || access.admins.has(pubkey.toLowerCase())
      setTimelineCapabilityRequest(canRecord ? timelineCapabilityRequests.begin() : null)
      setAdminCapabilityRequest(canAdmin ? adminCapabilityRequests.begin() : null)
      setContributorPubkeys(allowed)
      setIsWhitelisted(canRecord)
      setIsAdmin(canAdmin)
      setAccessDegraded(access.degraded)
    } catch {
      if (!accessRequests.isCurrent(request)) return
      manifestWriteRequests.invalidate()
      whitelistWriteRequests.invalidate()
      // Total failure — fail closed on record, but never lock out bootstrap
      // admins (they need the UI that fixes the list). fetchAccessLists
      // already encodes this; a throw here means something truly unexpected.
      // The Compass identity must retain the repair path even when every
      // whitelist relay is down; otherwise it cannot restore access.
      setTimelineCapabilityRequest(isBootstrapAdmin ? timelineCapabilityRequests.begin() : null)
      setAdminCapabilityRequest(isBootstrapAdmin ? adminCapabilityRequests.begin() : null)
      setIsWhitelisted(isBootstrapAdmin)
      setIsAdmin(isBootstrapAdmin)
      setContributorPubkeys(isBootstrapAdmin ? new Set([COMPASS_PUBKEY, ...ADMIN_PUBKEYS]) : new Set())
      setAccessDegraded(true)
    }
  }, [accessRequests, adminCapabilityRequests, manifestWriteRequests, timelineCapabilityRequests, whitelistWriteRequests])

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
    const saved = restorePersistedAuthSession(localStorage, sessionStorage)
    if (!saved) return

    const request = authRequests.begin()
    const restore = (promise: Promise<AuthState>, failure: string) => {
      promise
        .then((state) => {
          if (!authRequests.isCurrent(request)) return
          setAuth(state)
          setView('timeline')
        })
        .catch(() => {
          if (authRequests.isCurrent(request)) setRestoreError(failure)
        })
        .finally(() => {
          if (authRequests.isCurrent(request)) setRestoringAuth(false)
        })
    }

    setRestoringAuth(true)
    if (saved.method === 'extension' && typeof window !== 'undefined' && 'nostr' in window) {
      restore(connectWindowNostr(), 'Your browser signer could not restore this session.')
    } else if ((saved.method === 'amber' || saved.method === 'bunker') && saved.session) {
      restore(
        withSignerTimeout(restoreSession(saved.session, saved.method, saved.pubkey), 'Amber session restoration'),
        'Amber could not restore this session. Reopen Amber, then sign in again.',
      )
    } else {
      setRestoringAuth(false)
    }
    return () => authRequests.invalidate()
  }, [authRequests])

  // Public reading never depends on a signer. Resolve the selected/latest issue
  // once on mount so losing an auth session cannot hide already-published content.
  useEffect(() => {
    const request = issueRequests.begin()
    setIssueLoading(true)
    setIssueError(null)

    const savedIssueNumber = readSelectedIssueNumber(localStorage)
    const issueRequest = savedIssueNumber
      ? fetchIssueByDTag(`newsletter-${savedIssueNumber}`).then((saved) => saved ?? fetchLatestIssueWithSegments().then((populated) => populated ?? fetchLatestIssue()))
      : fetchLatestIssueWithSegments().then((populated) => populated ?? fetchLatestIssue())

    issueRequest
      .then((event) => {
        if (issueRequests.isCurrent(request) && event) setIssue(parseIssue(event))
      })
      .catch(async (err: unknown) => {
        const cached = await loadCachedIssue<CompassIssue, [string, NostrEvent[]][]>().catch(() => null)
        if (!issueRequests.isCurrent(request)) return
        if (cached) {
          setIssue(cached.issue)
          setCachedSegments(cached.segments)
          return
        }
        setIssueError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (issueRequests.isCurrent(request)) setIssueLoading(false)
      })
    return () => issueRequests.invalidate()
  }, [issueRequests])

  // Authentication only enables recording/admin capabilities. Keep it separate
  // from the public issue request to avoid duplicate relay loads and auth races.
  useEffect(() => {
    if (!auth || !issue) {
      clearAccess()
      return
    }
    void loadAccess(issue.issueNumber, auth.pubkey)
    return () => accessRequests.invalidate()
  }, [auth, issue, loadAccess, clearAccess, accessRequests])

  const handleSelectIssue = (event: NostrEvent) => {
    authRequests.invalidate()
    issueRequests.invalidate()
    clearAccess()
    setIssueLoading(true)
    setIssueError(null)
    try {
      const parsed = parseIssue(event)
      saveSelectedIssueNumber(localStorage, parsed.issueNumber)
      setIssue(parsed)
      setView('timeline')
    } catch (err: unknown) {
      setIssueError(err instanceof Error ? err.message : String(err))
    } finally {
      setIssueLoading(false)
    }
  }

  const navigateTo = useCallback((next: AppView) => {
    if (next !== 'auth') authRequests.invalidate()
    setView(next)
  }, [authRequests])

  const handleAuth = (state: AuthState, method: string) => {
    authRequests.invalidate()
    setRestoringAuth(false)
    clearAccess()
    setRestoreError(null)
    // Persist only the non-secret extension marker across browser sessions.
    // NIP-46 nbunksec values are signing capabilities, so keep them scoped
    // to this tab while still allowing ordinary page reload restoration.
    if (method === 'extension') {
      saveRestorableAuthSession(localStorage, { method: 'extension' })
      sessionStorage.removeItem(AUTH_SESSION_KEY)
    } else {
      localStorage.removeItem(AUTH_SESSION_KEY)
      saveRestorableAuthSession(
        sessionStorage,
        ((method === 'amber' || method === 'bunker') && state.session
          ? { method, session: state.session, pubkey: state.pubkey }
          : null),
      )
    }
    setAuth(state)
    setView('timeline')
  }

  useEffect(() => {
    let alive = true
    if (!auth) { setIdentityProfile(null); return () => { alive = false } }
    fetchProfiles([auth.pubkey]).then((profiles) => {
      if (alive) setIdentityProfile(profiles.get(auth.pubkey) ?? null)
    }).catch(() => { if (alive) setIdentityProfile(null) })
    return () => { alive = false }
  }, [auth])

  return (
    <div className={`app${view === 'admin' ? ' app--admin' : ''}`}>
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
            onClick={() => navigateTo('timeline')}
          >
            Timeline
          </button>
          <button
            className={`btn btn--ghost btn--small ${view === 'issue-picker' ? 'btn--active' : ''}`}
            onClick={() => navigateTo('issue-picker')}
          >
            Episodes
          </button>
          {auth && isAdmin && (
            <button
              className={`btn btn--ghost btn--small ${view === 'admin' ? 'btn--active' : ''}`}
              onClick={() => navigateTo('admin')}
            >
              Admin
            </button>
          )}
        </nav>
        {auth ? (
          <>
            <span className="app-identity" title={auth.pubkey}>
              {identityProfile?.picture && <img src={identityProfile.picture} alt="" />}
              {identityProfile?.name ?? nip19.npubEncode(auth.pubkey).slice(0, 16) + '…'}
            </span>
            {!isWhitelisted && !isAdmin && <span className="app-read-only" role="status">Read-only</span>}
            <button
            className="btn btn--ghost btn--small app-logout"
            onClick={() => {
              authRequests.invalidate()
              setRestoringAuth(false)
              clearAccess()
              localStorage.removeItem(AUTH_SESSION_KEY)
              sessionStorage.removeItem(AUTH_SESSION_KEY)
              setAuth(null)
              setView('timeline')
            }}
            aria-label="Log out"
          >
            Log out
          </button>
          </>
        ) : (
          <button
            className="btn btn--primary btn--small app-login"
            onClick={() => {
              authRequests.invalidate()
              setRestoringAuth(false)
              setView('auth')
            }}
          >
            Sign in to record
          </button>
        )}
      </header>

      <div className="app-body">
        {restoringAuth && (
          <div className="notice notice--warning" role="status">Restoring your Amber session…</div>
        )}
        {restoreError && (
          <div className="notice notice--error" role="alert">{restoreError}</div>
        )}
        {view === 'auth' && !auth && <AuthScreen onAuth={handleAuth} authRequests={authRequests} />}

        {accessDegraded && (
          <div className="notice notice--warning" role="alert">
            Couldn't load the contributor list — recording is paused.
            <button
              className="btn btn--ghost btn--small"
              onClick={() => {
                if (!issue || !auth) return
                clearAccess()
                void loadAccess(issue.issueNumber, auth.pubkey)
              }}
            >
              Retry
            </button>
          </div>
        )}
        {view !== 'auth' && issueLoading && (
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
            signer={auth?.signer ?? null}
            myPubkey={auth?.pubkey ?? null}
            canRecord={Boolean(auth && isWhitelisted)}
            capabilityRequests={timelineCapabilityRequests}
            capabilityRequest={timelineCapabilityRequest}
            cachedSegments={cachedSegments}
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
            onBack={() => navigateTo('timeline')}
          />
        )}

        {view === 'admin' && isAdmin && issue && auth && (
          <Suspense fallback={<div className="app-empty"><p>Loading admin tools…</p></div>}>
            <AdminPanel
              issue={issue}
              signer={auth.signer}
              pubkey={auth.pubkey}
              contributorPubkeys={contributorPubkeys}
              manifestWriteRequests={manifestWriteRequests}
              whitelistWriteRequests={whitelistWriteRequests}
              capabilityRequests={adminCapabilityRequests}
              capabilityRequest={adminCapabilityRequest}
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

function AuthScreen({ onAuth, authRequests }: {
  onAuth: (state: AuthState, method: string) => void
  authRequests: LatestRequestGuard
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

  // Cancel pending sign-in and revoke every interactive continuation on unmount.
  useEffect(() => () => {
    authRequests.invalidate()
    amberCancelRef.current?.()
  }, [authRequests])

  function handleAmber() {
    const request = authRequests.begin()
    // Everything before the navigation must be synchronous — Android Chrome
    // blocks scheme navigations that aren't tied directly to the user gesture.
    setError(null)
    try {
      const handle = startAmberConnect()
      amberCancelRef.current = handle.cancel
      setAmberWaiting(true)
      handle.wait()
        .then((state) => {
          if (!authRequests.isCurrent(request)) return
          amberCancelRef.current = null
          onAuth(state, 'amber')
        })
        .catch((err) => {
          if (!authRequests.isCurrent(request)) return
          setAmberWaiting(false)
          if (!(err instanceof Error && err.message === 'Aborted')) {
            setError(err instanceof Error ? err.message : String(err))
          }
        })
      window.location.href = handle.uri // synchronous deep link into Amber
    } catch (err) {
      if (!authRequests.isCurrent(request)) return
      setAmberWaiting(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExtension() {
    const request = authRequests.begin()
    setError(null)
    setLoading('extension')
    try {
      const state = await connectWindowNostr()
      if (!authRequests.isCurrent(request)) return
      onAuth(state, 'extension')
    } catch (err) {
      if (!authRequests.isCurrent(request)) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (authRequests.isCurrent(request)) setLoading(null)
    }
  }

  async function handleAdvancedConnect() {
    const request = authRequests.begin()
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
      if (!authRequests.isCurrent(request)) return
      onAuth(state, advanced)
    } catch (err) {
      if (!authRequests.isCurrent(request)) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (authRequests.isCurrent(request)) setLoading(null)
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
                  authRequests.invalidate()
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
