import { useEffect, useRef, useState } from 'react'
import type { AuthState } from '../lib/auth'
import { connectBunker, connectNsec, connectWindowNostr, startAmberConnect } from '../lib/auth'
import type { LatestRequestGuard } from '../lib/latest-request'

export default function AuthScreen({ onAuth, authRequests }: {
  onAuth: (state: AuthState, method: string) => void
  authRequests: LatestRequestGuard
}) {
  const [advanced, setAdvanced] = useState<'bunker' | 'nsec' | null>(null)
  const [input, setInput] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [amberWaiting, setAmberWaiting] = useState(false)
  const amberCancelRef = useRef<(() => void) | null>(null)
  const hasExtension = typeof window !== 'undefined' && 'nostr' in window
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

  useEffect(() => () => {
    authRequests.invalidate()
    amberCancelRef.current?.()
  }, [authRequests])

  function handleAmber() {
    const request = authRequests.begin()
    // Android blocks scheme navigation unless it remains synchronous with the
    // user gesture, so this module is loaded before the button can be clicked.
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
      window.location.href = handle.uri
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
      if (advanced === 'bunker') state = await connectBunker(input.trim())
      else if (advanced === 'nsec') state = await connectNsec(input.trim(), passphrase || undefined)
      else return
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
              onChange={(event) => setInput(event.target.value)}
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
                onChange={(event) => setInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {input.startsWith('ncryptsec') && (
                <input
                  className="auth-input"
                  type="password"
                  placeholder="Passphrase"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
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
