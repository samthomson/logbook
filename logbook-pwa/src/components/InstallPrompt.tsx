/**
 * InstallPrompt — shows the PWA "Add to Home Screen" banner
 * when the browser fires the beforeinstallprompt event.
 * Hidden on iOS where the browser never fires that event
 * (iOS users install via Share → Add to Home Screen).
 */

import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!prompt || dismissed) return null

  const handleInstall = async () => {
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted' || outcome === 'dismissed') {
      setPrompt(null)
      setDismissed(true)
    }
  }

  return (
    <div className="install-prompt" role="banner">
      <span className="install-prompt__text">Install Logbook for offline access</span>
      <div className="install-prompt__actions">
        <button className="btn btn--primary btn--small" onClick={handleInstall}>
          Install
        </button>
        <button className="btn btn--ghost btn--small" onClick={() => setDismissed(true)}>
          Not now
        </button>
      </div>
    </div>
  )
}
