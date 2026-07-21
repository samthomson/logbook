/**
 * useStickyAboveKeyboard — keeps action buttons visible when the on-screen
 * keyboard opens (mobile). Uses visualViewport to detect keyboard occlusion
 * and applies a bottom offset so the element floats above the keyboard while
 * the page scrolls behind it.
 */

import { useEffect, useState } from 'react'

export function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      // How much of the layout viewport is covered by the keyboard
      const covered = window.innerHeight - vv.height - vv.offsetTop
      setOffset(Math.max(0, covered))
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return offset
}
