import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import type { AuthState } from './lib/auth'
import { AUTH_SESSION_KEY, restorePersistedAuthSession, saveRestorableAuthSession, saveSelectedIssueNumber } from './lib/session'
import { routeIssueNumber, useRoute, type Route } from './lib/route'
import { withSignerTimeout } from './lib/signer-timeout'
import { createLatestRequestGuard } from './lib/latest-request'
import { useKeyboardOffset } from './lib/useKeyboardOffset'

import IssueTimeline from './components/IssueTimeline'
import IssuePicker from './components/IssuePicker'
import InstallPrompt from './components/InstallPrompt'
const AuthScreen = lazy(() => import('./components/AuthScreen'))
import { extractIssueNumber, fetchIssueByDTag, fetchLatestIssue, parseIssue } from './lib/compass'
import { checkRecordingSupport } from './lib/utils'
import { COMPASS_PUBKEY, IOS_RECORDING_MIN_VERSION } from './config'
import { fetchAccessLists, fetchProducerPubkeys } from './lib/whitelist'
import { loadCachedIssue } from './lib/issue-cache'
import { fetchProfiles, type Profile } from './lib/profiles'
import { avatarInitials, avatarStyle } from './lib/avatar'
import { nip19 } from 'nostr-tools'
import type { CompassIssue, ManifestContent, NostrEvent } from './types/nostr'
import { loadAccessSnapshot, saveAccessSnapshot, clearAccessSnapshot } from './lib/access-cache'
import { fetchManifest, subscribeManifest } from './lib/manifest'
import { selectAuthoritativeManifestRevision } from './lib/manifest-revision'
import './App.css'

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [restoringAuth, setRestoringAuth] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [route, navigate] = useRoute()
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  const [issue, setIssue] = useState<CompassIssue | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [contributorPubkeys, setContributorPubkeys] = useState<Set<string>>(new Set())
  const [producerPubkeys, setProducerPubkeys] = useState<Set<string>>(new Set())
  const [accessDegraded, setAccessDegraded] = useState(false)
  const [issueLoading, setIssueLoading] = useState(true)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [cachedSegments, setCachedSegments] = useState<[string, NostrEvent[]][]>([])
  const [newerIssueEvent, setNewerIssueEvent] = useState<NostrEvent | null>(null)
  const [identityProfile, setIdentityProfile] = useState<Profile | null>(null)
  // Being a producer is a property of the key, not of the page you are on, so
  // the header must not depend on an episode being loaded. Editing still waits
  // for the per-episode capability check below.
  const [isProducerKey, setIsProducerKey] = useState(false)
  const [stageManifest, setStageManifest] = useState<ManifestContent | null>(null)
  const [stageLoading, setStageLoading] = useState(false)
  const stagedIssueRef = useRef<number | null>(null)
  const stageEventRef = useRef<NostrEvent | null>(null)
  const keyboardOffset = useKeyboardOffset()
  const [issueRequests] = useState(createLatestRequestGuard)
  const [stageRequests] = useState(createLatestRequestGuard)
  const [accessRequests] = useState(createLatestRequestGuard)
  const [authRequests] = useState(createLatestRequestGuard)
  const [manifestWriteRequests] = useState(createLatestRequestGuard)
  const [whitelistWriteRequests] = useState(createLatestRequestGuard)
  const [timelineCapabilityRequests] = useState(createLatestRequestGuard)
  const [timelineCapabilityRequest, setTimelineCapabilityRequest] = useState<number | null>(null)
  const [adminCapabilityRequests] = useState(createLatestRequestGuard)
  const [adminCapabilityRequest, setAdminCapabilityRequest] = useState<number | null>(null)
  const accessGrantRef = useRef({ issueNumber: null as number | null, pubkey: null as string | null, canRecord: false, canAdmin: false })
  const episodeNumber = routeIssueNumber(route)
  // An episode in progress belongs to the people making it. Everyone else waits
  // for the published one — cosmetic, since the events themselves are public.
  const canSeeUnpublished = Boolean(auth)
  const episodeIsPublished = stageManifest?.episodeStatus === 'published'
  // Where to return after a login detour, so signing in never dumps you home.
  const afterLoginRef = useRef<Route>({ kind: 'home' })

  const goToLogin = useCallback(() => {
    authRequests.invalidate()
    setRestoringAuth(false)
    if (route.kind !== 'login') afterLoginRef.current = route
    navigate({ kind: 'login' })
  }, [authRequests, navigate, route])

  const applyAccess = useCallback((
    issueNumber: number,
    pubkey: string,
    allowed: Set<string>,
    admins: Set<string>,
    degraded: boolean,
  ) => {
    const normalized = pubkey.toLowerCase()
    const canRecord = true
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
    setProducerPubkeys(new Set([...admins].map((key) => key.toLowerCase())))
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
    setIsAdmin(false)
    setContributorPubkeys(new Set())
    setProducerPubkeys(new Set())
    setAccessDegraded(false)
    accessGrantRef.current = { issueNumber: null, pubkey: null, canRecord: false, canAdmin: false }
  }, [accessRequests, adminCapabilityRequests, manifestWriteRequests, timelineCapabilityRequests, whitelistWriteRequests])

  /** Single access-control fetch — canRecord + isAdmin derive from the same
   *  verified response. A cache may restore recorder UI, but never a write or
   *  admin capability; recordings made while offline remain local drafts. */
  const loadAccess = useCallback(async (issueNumber: number, pubkey: string) => {
    const request = accessRequests.begin()
    const normalizedPubkey = pubkey.toLowerCase()
    const cached = loadAccessSnapshot(sessionStorage, issueNumber, pubkey)

    // Revoke every prior remote-write capability before refresh. Cached access
    // is only a same-tab UX hint and cannot authorize publication or admin work.
    manifestWriteRequests.invalidate()
    whitelistWriteRequests.invalidate()
    timelineCapabilityRequests.invalidate()
    adminCapabilityRequests.invalidate()
    // Recording authority is authentication, not roster membership. The
    // signer/issue-bound request token still revokes in-flight work on change.
    setTimelineCapabilityRequest(timelineCapabilityRequests.begin())
    setAdminCapabilityRequest(null)
    accessGrantRef.current = { issueNumber, pubkey: normalizedPubkey, canRecord: false, canAdmin: false }
    setIsAdmin(false)
    if (cached) {
      setContributorPubkeys(cached.allowed)
      setAccessDegraded(true)
    } else {
      setContributorPubkeys(new Set())
      setAccessDegraded(false)
    }

    try {
      const access = await fetchAccessLists(issueNumber, undefined, { forceRefresh: true })
      if (!accessRequests.isCurrent(request)) return
      if (access.degraded) {
        setAccessDegraded(true)
        return
      }
      // Admin review uses only the verified relay-backed access result. Local
      // build configuration must never restore a producer revoked on relay.
      const allowed = new Set([...access.contributors, ...access.admins])
      allowed.add(COMPASS_PUBKEY)
      const admins = new Set(access.admins)
      admins.add(COMPASS_PUBKEY)
      applyAccess(issueNumber, pubkey, allowed, admins, false)
      saveAccessSnapshot(sessionStorage, { issueNumber, pubkey, allowed, admins })
    } catch {
      if (!accessRequests.isCurrent(request)) return
      setAccessDegraded(true)
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
        })
        .catch(() => {
          if (!authRequests.isCurrent(request)) return
          // Restoration failures are often transient (locked extension,
          // backgrounded Amber, or a slow bunker relay). Keep the revocable
          // session marker so retry/reload can recover; explicit logout or a
          // replacement login remains the destructive boundary.
          setRestoreError(failure)
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
    if (episodeNumber === null) {
      issueRequests.invalidate()
      setIssue(null)
      setCachedSegments([])
      setNewerIssueEvent(null)
      setIssueError(null)
      setIssueLoading(false)
      return
    }

    const request = issueRequests.begin()
    setIssueLoading(true)
    setIssueError(null)
    setNewerIssueEvent(null)

    void (async () => {
      const cached = await loadCachedIssue(episodeNumber).catch(() => null)
      if (!issueRequests.isCurrent(request)) return
      if (cached) {
        setIssue(cached.issue)
        setCachedSegments(cached.segments)
        setIssueLoading(false)
      }

      try {
        const event = await fetchIssueByDTag(`newsletter-${episodeNumber}`)
        if (!issueRequests.isCurrent(request)) return
        if (!event) {
          if (!cached) {
            setIssue(null)
            setIssueError(`Episode ${episodeNumber} is not on the relays.`)
          }
          return
        }
        const parsed = parseIssue(event)
        setCachedSegments(cached?.issue.issueNumber === parsed.issueNumber ? cached.segments : [])
        setIssue(parsed)
        saveSelectedIssueNumber(localStorage, parsed.issueNumber)
        void fetchLatestIssue().then((latest) => {
          if (!issueRequests.isCurrent(request) || !latest) return
          setNewerIssueEvent(extractIssueNumber(latest) > parsed.issueNumber ? latest : null)
        }).catch(() => {})
      } catch (err: unknown) {
        if (issueRequests.isCurrent(request) && !cached) {
          setIssueError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (issueRequests.isCurrent(request)) setIssueLoading(false)
      }
    })()
    return () => issueRequests.invalidate()
  }, [episodeNumber, issueRequests])

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
    navigate({ kind: 'episode', issueNumber: extractIssueNumber(event) })
  }

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
    navigate(afterLoginRef.current)
  }

  // The stage bar shows in every view, so the manifest is read here rather than
  // inside the Admin panel. An absent manifest is a valid state (nothing cut
  // yet), so a failed lookup leaves the bar on its recording stage.
  useEffect(() => {
    if (!issue) {
      stagedIssueRef.current = null
      stageEventRef.current = null
      setStageManifest(null)
      setStageLoading(false)
      return
    }
    const request = stageRequests.begin()
    const switching = stagedIssueRef.current !== issue.issueNumber
    stagedIssueRef.current = issue.issueNumber
    if (switching) {
      stageEventRef.current = null
      setStageManifest(null)
      setStageLoading(true)
    }
    fetchManifest(issue.issueNumber)
      .then((manifest) => {
        if (!stageRequests.isCurrent(request)) return
        stageEventRef.current = manifest?.event ?? null
        setStageManifest(manifest?.content ?? null)
      })
      .catch(() => {
        if (!stageRequests.isCurrent(request)) return
        // Keep the last authoritative manifest for this issue on transient
        // relay failures. A route switch already cleared unrelated state.
      })
      .finally(() => {
        if (stageRequests.isCurrent(request)) setStageLoading(false)
      })
    const unsubscribe = subscribeManifest(issue.issueNumber, (manifest) => {
      if (!stageRequests.isCurrent(request)) return
      const current = stageEventRef.current
      if (
        current
        && selectAuthoritativeManifestRevision([manifest.event, current])?.id !== manifest.event.id
      ) return
      stageEventRef.current = manifest.event
      setStageManifest(manifest.content)
    })
    return () => {
      unsubscribe()
      stageRequests.invalidate()
    }
  }, [issue, stageRequests])

  // A signed-in visitor has no business on the login screen (bookmark, back button).
  useEffect(() => {
    if (route.kind === 'login' && auth) navigate(afterLoginRef.current)
  }, [route.kind, auth, navigate])

  useEffect(() => {
    if (!auth) {
      setIsProducerKey(false)
      return
    }
    let alive = true
    fetchProducerPubkeys()
      .then((producers) => { if (alive) setIsProducerKey(producers.has(auth.pubkey.toLowerCase())) })
      .catch(() => { if (alive) setIsProducerKey(false) })
    return () => { alive = false }
  }, [auth])

  useEffect(() => {
    let alive = true
    if (!auth) { setIdentityProfile(null); return () => { alive = false } }
    fetchProfiles([auth.pubkey]).then((profiles) => {
      if (alive) setIdentityProfile(profiles.get(auth.pubkey) ?? null)
    }).catch(() => { if (alive) setIdentityProfile(null) })
    return () => { alive = false }
  }, [auth])

  return (
    <div className="app">
      {recordingNotice && (
        <div className="notice notice--warning" role="alert">
          {recordingNotice}
        </div>
      )}

      <InstallPrompt />

      <header className="app-header">
        <button className="app-title" onClick={() => navigate({ kind: 'home' })} title="All episodes">
          Logbook
        </button>
        <nav className="app-nav">
          {episodeNumber !== null && (
            <button className="btn btn--ghost btn--small" onClick={() => navigate({ kind: 'home' })}>
              All episodes
            </button>
          )}
        </nav>
        {auth ? (
          <>
            <span className="app-identity" title={auth.pubkey}>
              <span
                className="app-identity__avatar"
                style={identityProfile?.picture ? undefined : avatarStyle(auth.pubkey)}
                aria-hidden="true"
              >
                {identityProfile?.picture ? (
                  <img src={identityProfile.picture} alt="" loading="lazy" />
                ) : (
                  <span>{avatarInitials(identityProfile?.name, auth.pubkey)}</span>
                )}
              </span>
              <span className="app-identity__text">
                <code>{nip19.npubEncode(auth.pubkey).slice(0, 16)}…</code>
                {identityProfile?.name && <strong>{identityProfile.name}</strong>}
              </span>
            </span>
            {isProducerKey || isAdmin ? (
              <span className="app-role app-role--producer" role="status">Producer</span>
            ) : (
              <span className="app-role" role="status">Contributor</span>
            )}
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
              navigate({ kind: 'home' })
            }}
            aria-label="Log out"
          >
            Log out
          </button>
          </>
        ) : (
          <button className="btn btn--primary btn--small app-login" onClick={goToLogin}>
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
                goToLogin()
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
                goToLogin()
              }}
            >
              Log in again
            </button>
          </div>
        )}
        {route.kind === 'login' && !auth && !restoringAuth && (
          <Suspense fallback={<div className="app-loading"><div className="spinner" aria-label="Loading login" /></div>}>
            <AuthScreen onAuth={handleAuth} authRequests={authRequests} />
          </Suspense>
        )}

        {accessDegraded && episodeNumber !== null && (
          <div className="notice notice--warning" role="alert">
            Couldn't verify the validation roster — producer cut eligibility is paused.
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
        {episodeNumber !== null && issueLoading && (
          <div className="app-loading">
            <div className="spinner" aria-label="Loading" />
            <p>Loading episode…</p>
          </div>
        )}
        {issueError && (
          <div className="notice notice--error">
            Failed to load episode: {issueError}
          </div>
        )}

        {route.kind === 'episode' && !issueLoading && issue && newerIssueEvent && (
          <div className="notice notice--episode" role="status">
            <span>
              Showing Compass #{issue.issueNumber}. Compass #{extractIssueNumber(newerIssueEvent)} is newer.
            </span>
            <button className="btn btn--ghost btn--small" onClick={() => handleSelectIssue(newerIssueEvent)}>
              Open newer episode
            </button>
          </div>
        )}

        {route.kind === 'episode' && !issueLoading && issue && stageLoading && (
          <div className="app-loading">
            <div className="spinner" aria-label="Loading episode" />
          </div>
        )}

        {route.kind === 'episode' && !issueLoading && !stageLoading && issue
          && !episodeIsPublished && !canSeeUnpublished && (
          <div className="app-empty">
            <p>
              This episode is still being made. It opens to everyone once it is published.
            </p>
          </div>
        )}

        {route.kind === 'episode' && !issueLoading && !stageLoading && issue
          && (episodeIsPublished || canSeeUnpublished) && (
          <IssueTimeline
            issue={issue}
            signer={auth?.signer ?? null}
            myPubkey={auth?.pubkey ?? null}
            canRecord={Boolean(auth)}
            capabilityRequests={timelineCapabilityRequests}
            capabilityRequest={timelineCapabilityRequest}
            cachedSegments={cachedSegments}
            producer={auth && isAdmin ? {
              signer: auth.signer,
              pubkey: auth.pubkey,
              producerPubkeys,
              contributorPubkeys,
              manifestWriteRequests,
              whitelistWriteRequests,
              capabilityRequests: adminCapabilityRequests,
              capabilityRequest: adminCapabilityRequest,
              onPublished: (content) => setStageManifest(content),
            } : null}
          />
        )}

        {route.kind === 'home' && (
          <IssuePicker
            currentIssueNumber={null}
            onDraftStarted={(issueNumber) => navigate({ kind: 'episode', issueNumber })}
            showUnpublished={Boolean(auth)}
            producer={auth && isProducerKey ? {
              signer: auth.signer,
              pubkey: auth.pubkey,
              writeRequests: manifestWriteRequests,
            } : null}
          />
        )}

      </div>

      {!auth && route.kind !== 'login' && !restoringAuth && (
        <div className="app-signin" role="region" aria-label="Sign in">
          <p>Recording and producing are not on this page.</p>
          <button type="button" className="btn btn--primary" onClick={goToLogin}>
            Log in
          </button>
        </div>
      )}
    </div>
  )
}
