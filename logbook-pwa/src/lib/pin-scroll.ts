/**
 * NIP-46 popups and focus return can reset the document to y=0. Restore the
 * captured position only for lifecycle/focus events; never fight deliberate
 * user scrolling while a signer request is pending.
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
  const onPageShow = () => restore()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') restore()
  }
  const onViewportResize = () => restore()

  window.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.visualViewport?.addEventListener('resize', onViewportResize)

  return () => {
    window.removeEventListener('focusin', onFocusIn, true)
    window.removeEventListener('pageshow', onPageShow)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.visualViewport?.removeEventListener('resize', onViewportResize)
    history.scrollRestoration = previousRestoration
    document.documentElement.classList.remove('scroll-pinned')
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

/** Keep an upload replacement in place while React swaps draft and segment rows. */
export function preserveScrollAfterMutation(
  mutate: () => void,
  read = () => window.scrollY,
  write = (y: number) => window.scrollTo(0, y),
  schedule = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
): void {
  const y = read()
  mutate()
  schedule(() => schedule(() => write(y)))
}
