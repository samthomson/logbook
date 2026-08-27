/**
 * NIP-46 popups and focus return reset the document to y=0. Hold the current
 * scroll until the caller releases — overlapping pins keep the first position.
 */

let depth = 0
let pinnedY = 0
let teardown: (() => void) | null = null

function scrollingElement(): Element {
  return document.scrollingElement ?? document.documentElement
}

function restore(): void {
  const node = scrollingElement()
  if (node.scrollTop !== pinnedY) node.scrollTop = pinnedY
  if (window.scrollY !== pinnedY) window.scrollTo(0, pinnedY)
}

function start(): () => void {
  pinnedY = window.scrollY
  document.documentElement.classList.add('scroll-pinned')
  const previousRestoration = history.scrollRestoration
  history.scrollRestoration = 'manual'

  const onFocusIn = () => restore()

  window.addEventListener('scroll', restore, true)
  window.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('pageshow', restore)
  document.addEventListener('visibilitychange', restore)
  window.visualViewport?.addEventListener('scroll', restore)
  window.visualViewport?.addEventListener('resize', restore)

  let frame = 0
  const loop = () => {
    restore()
    frame = window.requestAnimationFrame(loop)
  }
  frame = window.requestAnimationFrame(loop)

  return () => {
    window.cancelAnimationFrame(frame)
    window.removeEventListener('scroll', restore, true)
    window.removeEventListener('focusin', onFocusIn, true)
    window.removeEventListener('pageshow', restore)
    document.removeEventListener('visibilitychange', restore)
    window.visualViewport?.removeEventListener('scroll', restore)
    window.visualViewport?.removeEventListener('resize', restore)
    history.scrollRestoration = previousRestoration
    document.documentElement.classList.remove('scroll-pinned')
    restore()
  }
}

export function pinWindowScroll(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (depth === 0) teardown = start()
  depth += 1
  let released = false
  return () => {
    if (released) return
    released = true
    depth -= 1
    if (depth > 0) return
    teardown?.()
    teardown = null
  }
}
