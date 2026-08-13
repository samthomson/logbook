import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import type { AuthState } from './lib/auth'
import { AUTH_SESSION_KEY, readSelectedIssueNumber, restorePersistedAuthSession, saveRestorableAuthSession, saveSelectedIssueNumber } from './lib/session'
import { withSignerTimeout } from './lib/signer-timeout'
import { createLatestRequestGuard } from './lib/latest-request'
import { useKeyboardOffset } from './lib/useKeyboardOffset'

import IssueTimeline from './components/IssueTimeline'
import IssuePicker from './components/IssuePicker'
import InstallPrompt from './components/InstallPrompt'
const AuthScreen = lazy(() => import('./components/AuthScreen'))
const AdminPanel = lazy(() => import('./components/AdminPanel'))
import { extractIssueNumber, fetchIssueByDTag, fetchLatestIssue, fetchLatestIssueWithSegments, parseIssue } from './lib/compass'
import { checkRecordingSupport } from './lib/utils'
import { ADMIN_PUBKEYS, COMPASS_PUBKEY, IOS_RECORDING_MIN_VERSION } from './config'
import { fetchAccessLists } from './lib/whitelist'
import { loadCachedIssue } from './lib/issue-cache'
import { fetchProfiles, type Profile } from './lib/profiles'
import { nip19 } from 'nostr-tools'
import type { CompassIssue, NostrEvent } from './types/nostr'
import { loadAccessSnapshot, saveAccessSnapshot, clearAccessSnapshot } from './lib/access-cache'
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
  const [newerIssueEvent, setNewerIssueEvent] = useState<NostrEvent | null>(null)
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
  const accessGrantRef = useRef({ issueNumber: null as number | null, pubkey: null as string | null, canRecord: false, canAdmin: false })

  const applyAccess = useCallback((
    issueNumber: number,
    pubkey: string,
    allowed: Set<string>,
    admins: Set<string>,
    degraded: boolean,
  ) => {
    const normalized = pubkey.toLowerCase()
    const canRecord = allowed.has(normalized)
    const canAdmin = admins.has(normalized)
    const previous = accessGrantRef.current
    const sameContext = previous.issueNumber === issueNumber && previous.pubkey === normalized

    if (!sameContext || previous.canRecord !== canRecord) {
      timelineCapabilityRequests.invalidate()
      setTimelineCapabilityRequest(canRecord ? timelineCapabilityRequests.begin() : null)
    }
    if (!sameContext || previous.canAdmin !== canAdmin) {
      adminCapabilityRequests.invalidate()
      setAdminCapabilityRequest(canAdmin ? adminCapabilityRequests.begin() : null)
    }
    accessGrantRef.current = { issueNumber, pubkey: normalized, canRecord, canAdmin }
    setContributorPubkeys(allowed)
    setIsWhitelisted(canRecord)
    setIsAdmin(canAdmin)
    setAccessDegraded(degraded)
  }, [adminCapabilityRequests, timelineCapabilityRequests])

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
    accessGrantRef.current = { issueNumber: null, pubkey: null, canRecord: false, canAdmin: false }
  }, [accessRequests, adminCapabilityRequests, manifestWriteRequests, timelineCapabilityRequests, whitelistWriteRequests])

  /** Single access-control fetch — canRecord + isAdmin derive from the same
   *  verified response. A cache may restore recorder UI, but never a write or
   *  admin capability; recordings made while offline remain local drafts. */
  const loadAccess = useCallback(async (issueNumber: number, pubkey: string) => {
    const request = accessRequests.begin()
    const normalizedPubkey = pubkey.toLowerCase()
    const isCompass = normalizedPubkey === COMPASS_PUBKEY.toLowerCase()
    const isBootstrapAdmin = isCompass || ADMIN_PUBKEYS.some((admin) => admin.toLowerCase() === normalizedPubkey)
    const cached = loadAccessSnapshot(sessionStorage, issueNumber, pubkey)

    // Revoke every prior remote-write capability before refresh. Cached access
    // is only a same-tab UX hint and cannot authorize publication or admin work.
    manifestWriteRequests.invalidate()
    whitelistWriteRequests.invalidate()
    timelineCapabilityRequests.invalidate()
    adminCapabilityRequests.invalidate()
    setTimelineCapabilityRequest(null)
    setAdminCapabilityRequest(null)
    accessGrantRef.current = { issueNumber, pubkey: normalizedPubkey, canRecord: false, canAdmin: false }
    setIsAdmin(false)
    if (cached) {
      setContributorPubkeys(cached.allowed)
      setIsWhitelisted(cached.allowed.has(normalizedPubkey))
      setAccessDegraded(true)
    } else {
      setContributorPubkeys(new Set())
      setIsWhitelisted(false)
      setAccessDegraded(false)
    }

    const applyBootstrapRepairAccess = () => {
      const allowed = new Set([COMPASS_PUBKEY, ...ADMIN_PUBKEYS, normalizedPubkey])
      const admins = new Set([COMPASS_PUBKEY, ...ADMIN_PUBKEYS, normalizedPubkey])
      applyAccess(issueNumber, pubkey, allowed, admins, true)
    }

    try {
      const access = await fetchAccessLists(issueNumber, undefined, { forceRefresh: true })
      if (!accessRequests.isCurrent(request)) return
      if (access.degraded) {
        if (isBootstrapAdmin) applyBootstrapRepairAccess()
        else setAccessDegraded(true)
        return
      }
      // Admin review must use the same merged set that grants recording,
      // including admins who are allowed to contribute without a separate
      // contributor-list entry.
      const allowed = new Set([...access.contributors, ...access.admins])
      allowed.add(COMPASS_PUBKEY)
      if (isBootstrapAdmin) allowed.add(normalizedPubkey)
      const admins = new Set(access.admins)
      if (isBootstrapAdmin) admins.add(normalizedPubkey)
      applyAccess(issueNumber, pubkey, allowed, admins, false)
      saveAccessSnapshot(sessionStorage, { issueNumber, pubkey, allowed, admins })
    } catch {
      if (!accessRequests.isCurrent(request)) return
      if (isBootstrapAdmin) applyBootstrapRepairAccess()
      else setAccessDegraded(true)
    }
  }, [
    accessRequests,
    adminCapabilityRequests,
    applyAccess,
    manifestWriteRequests,
    timelineCapabilityRequests,
    whitelistWriteRequests,
  ])

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
          if (!authRequests.isCurrent(request)) return
          // Drop a stuck marker so the next reload does not hang on the same prompt.
          localStorage.removeItem(AUTH_SESSION_KEY)
          sessionStorage.removeItem(AUTH_SESSION_KEY)
          setRestoreError(failure)
          setView('auth')
        })
        .finally(() => {
          if (authRequests.isCurrent(request)) setRestoringAuth(false)
        })
    }

    setRestoringAuth(true)
    void import('./lib/auth')
      .then(({ connectWindowNostr, restoreSession }) => {
        if (!authRequests.isCurrent(request)) return
        if (saved.method === 'extension' && typeof window !== 'undefined' && 'nostr' in window) {
          restore(
            withSignerTimeout(connectWindowNostr(), 'Browser extension login', 30_000),
            'Your browser extension did not respond. Unlock it and try Log in again.',
          )
        } else if ((saved.method === 'amber' || saved.method === 'bunker') && saved.session) {
          restore(
            withSignerTimeout(restoreSession(saved.session, saved.method, saved.pubkey), 'Signer session restoration'),
            'Could not restore your signer session. Sign in again.',
          )
        } else {
          setRestoringAuth(false)
        }
      })
      .catch(() => {
        if (!authRequests.isCurrent(request)) return
        setRestoreError('The signer module could not be loaded. Reload and try again.')
        setRestoringAuth(false)
      })
    return () => authRequests.invalidate()
  }, [authRequests])

  // Public reading never depends on a signer. Render the last verified snapshot
  // first, then refresh it from relays without putting a returning PWA behind a
  // network spinner. A saved issue needs only one d-tag lookup on the critical
  // path; the newer-episode check runs independently.
  useEffect(() => {
    const request = issueRequests.begin()
    setIssueLoading(true)
    setIssueError(null)

    const savedIssueNumber = readSelectedIssueNumber(localStorage)
    const preferredPromise = fetchLatestIssueWithSegments().then((populated) => populated ?? fetchLatestIssue())
    // A saved issue can resolve before the background newer-episode lookup.
    // Attach rejection handling immediately so a fast relay failure cannot
    // surface as an unhandled promise before that background branch is read.
    void preferredPromise.catch(() => {})
    const selectedPromise = savedIssueNumber === null
      ? preferredPromise
      : fetchIssueByDTag(`newsletter-${savedIssueNumber}`).then((saved) => saved ?? preferredPromise)

    void (async () => {
      const cached = await loadCachedIssue(savedIssueNumber ?? undefined).catch(() => null)
      if (!issueRequests.isCurrent(request)) return
      if (cached) {
        setIssue(cached.issue)
        setCachedSegments(cached.segments)
        setNewerIssueEvent(null)
        setIssueLoading(false)
      }

      try {
        const selected = await selectedPromise
        if (!issueRequests.isCurrent(request)) return
        if (!selected) {
          if (!cached) setIssue(null)
          return
        }
        const parsed = parseIssue(selected)
        const sameCachedIssue = cached?.issue.issueNumber === parsed.issueNumber
        setCachedSegments(sameCachedIssue ? cached.segments : [])
        setIssue(parsed)
        if (savedIssueNumber !== null) {
          void preferredPromise.then((latest) => {
            if (!issueRequests.isCurrent(request) || !latest) return
            setNewerIssueEvent(extractIssueNumber(latest) > parsed.issueNumber ? latest : null)
          }).catch(() => {})
        } else {
          setNewerIssueEvent(null)
        }
      } catch (err: unknown) {
        if (issueRequests.isCurrent(request) && !cached) {
          setIssueError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (issueRequests.isCurrent(request)) setIssueLoading(false)
      }
    })()
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

  useEffect(() => {
    if (!auth || !issue) return
    const refreshAccess = () => {
      if (document.visibilityState === 'visible') void loadAccess(issue.issueNumber, auth.pubkey)
    }
    document.addEventListener('visibilitychange', refreshAccess)
    window.addEventListener('pageshow', refreshAccess)
    return () => {
      document.removeEventListener('visibilitychange', refreshAccess)
      window.removeEventListener('pageshow', refreshAccess)
    }
  }, [auth, issue, loadAccess])

  const handleSelectIssue = (event: NostrEvent) => {
    authRequests.invalidate()
    issueRequests.invalidate()
    clearAccess()
    setIssueLoading(true)
    setIssueError(null)
    try {
      const parsed = parseIssue(event)
      saveSelectedIssueNumber(localStorage, parsed.issueNumber)
      setCachedSegments([])
      setIssue(parsed)
      setNewerIssueEvent((current) => current && extractIssueNumber(current) > parsed.issueNumber ? current : null)
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
              clearAccessSnapshot(sessionStorage)
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
            Log in
          </button>
        )}
      </header>

      <div className="app-body">
        {restoringAuth && (
          <div className="notice notice--warning" role="status">
            <span>Restoring your login — approve in your extension if prompted…</span>
            <button
              className="btn btn--ghost btn--small"
              onClick={() => {
                authRequests.invalidate()
                localStorage.removeItem(AUTH_SESSION_KEY)
                sessionStorage.removeItem(AUTH_SESSION_KEY)
                setRestoringAuth(false)
                setRestoreError(null)
                setView('auth')
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {restoreError && (
          <div className="notice notice--error" role="alert">
            {restoreError}
            <button
              className="btn btn--ghost btn--small"
              onClick={() => {
                setRestoreError(null)
                setView('auth')
              }}
            >
              Log in again
            </button>
          </div>
        )}
        {view === 'auth' && !auth && !restoringAuth && (
          <Suspense fallback={<div className="app-loading"><div className="spinner" aria-label="Loading login" /></div>}>
            <AuthScreen onAuth={handleAuth} authRequests={authRequests} />
          </Suspense>
        )}

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

        {view === 'timeline' && !issueLoading && issue && newerIssueEvent && (
          <div className="notice notice--episode" role="status">
            <span>
              Showing Compass #{issue.issueNumber}. Compass #{extractIssueNumber(newerIssueEvent)} is newer.
            </span>
            <button className="btn btn--ghost btn--small" onClick={() => handleSelectIssue(newerIssueEvent)}>
              Open newer episode
            </button>
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
