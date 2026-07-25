import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { createServer } from 'vite'

const widths = [320, 360, 390]
const segmentIds = [1, 2, 3].map((value) => value.toString(16).padStart(64, '0'))
const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Vite QA server did not expose a port')
  const fixtureUrl = `http://127.0.0.1:${address.port}/scripts/fixtures/admin-layout.html`
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  const failures = []
  for (const width of widths) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: true })
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.episode-note__summary')
    const keyboardOffset = width === 360 ? 32 : 0
    await page.evaluate((offset) => {
      document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`)
    }, keyboardOffset)
    const summaries = await page.$$('.episode-note__summary')
    const dragHandles = await page.$$('.episode-note__drag')
    if (summaries.length !== 3 || dragHandles.length !== 3) throw new Error(`Expected 3 real recording rows at ${width}px`)
    const segmentOrderIs = (expected) => page.waitForFunction((target) => {
      const order = [...document.querySelectorAll('article[data-segment-id]')]
        .map((row) => row.getAttribute('data-segment-id'))
      return order.join(',') === target.join(',')
    }, { timeout: 1_000 }, expected)
    const introDragDisabled = await dragHandles[0].evaluate((handle) => (
      handle instanceof HTMLButtonElement && handle.disabled
    ))
    if (!introDragDisabled) throw new Error(`Pinned intro drag handle must be disabled at ${width}px`)
    await dragHandles[1].focus()
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-pressed') === 'true', { timeout: 1_000 })
    const liveRegionSelector = '[id^="DndLiveRegion-"][role="status"]'
    await page.waitForSelector(liveRegionSelector)
    const activationAnnouncement = await page.$eval(liveRegionSelector, (region) => region.textContent)
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction((selector, previous) => {
      const current = document.querySelector(selector)?.textContent
      return Boolean(current && current !== previous)
    }, { timeout: 1_000 }, liveRegionSelector, activationAnnouncement)
    await page.keyboard.press('Space')
    await segmentOrderIs([segmentIds[0], segmentIds[2], segmentIds[1]])
    const reorderedSummaries = await page.$$('.episode-note__summary')
    await reorderedSummaries[2].click()
    await page.waitForSelector('.episode-note__details')
    const clickMoveButton = async (label) => {
      const clicked = await page.evaluate((buttonLabel) => {
        const button = [...document.querySelectorAll('.episode-note__details button')]
          .find((candidate) => candidate.textContent?.trim() === buttonLabel)
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false
        button.click()
        return true
      }, label)
      if (!clicked) throw new Error(`Enabled ${label} control missing at ${width}px`)
    }
    await clickMoveButton('Move up')
    await segmentOrderIs(segmentIds)
    await clickMoveButton('Move down')
    await segmentOrderIs([segmentIds[0], segmentIds[2], segmentIds[1]])
    await page.waitForFunction(() => [...document.querySelectorAll('.episode-note__line')]
      .every((row) => row.getBoundingClientRect().height >= 44), { timeout: 1_000 })

    const layout = await page.evaluate(() => {
      const navProbe = document.createElement('nav')
      navProbe.className = 'app-nav'
      document.body.append(navProbe)
      const navProbeStyle = getComputedStyle(navProbe)
      const unscopedNav = { display: navProbeStyle.display, overflowX: navProbeStyle.overflowX }
      navProbe.remove()
      const rows = [...document.querySelectorAll('.episode-note__line')]
      const collapsedRows = rows.slice(0, 2)
      const footer = document.querySelector('.admin-workspace__actions')
      const expanded = document.querySelectorAll('.episode-note')[2]
      const details = expanded?.querySelector('.episode-note__details')
      if (!footer || !expanded || !details) throw new Error('Real Admin row/footer markup missing')
      const footerRect = footer.getBoundingClientRect()
      const offenders = [...document.querySelectorAll('body *')].filter((element) => {
        const rect = element.getBoundingClientRect()
        const dndLiveRegion = element.id.startsWith('DndLiveRegion-')
          && element.getAttribute('role') === 'status'
          && rect.width <= 1
          && rect.height <= 1
        if (dndLiveRegion) return false
        return rect.right > innerWidth + 0.5 || rect.left < -0.5
      }).map((element) => ({
        name: element.className || element.tagName,
        id: element.id,
        role: element.getAttribute('role'),
        rect: element.getBoundingClientRect().toJSON(),
      }))
      const targetRects = collapsedRows.flatMap((row) => [
        row.querySelector('.episode-note__drag')?.getBoundingClientRect(),
        row.querySelector('.episode-note__summary')?.getBoundingClientRect(),
      ]).filter(Boolean)
      const moveLabels = [...details.querySelectorAll('button')].map((button) => button.textContent?.trim())
      return {
        innerWidth,
        innerHeight,
        unscopedNav,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        rowHeights: collapsedRows.map((element) => element.getBoundingClientRect().height),
        touchTargets: targetRects.map((rect) => ({ width: rect.width, height: rect.height })),
        offenders,
        collapsedText: collapsedRows.map((row) => row.textContent ?? ''),
        segmentOrder: [...document.querySelectorAll('article[data-segment-id]')]
          .map((row) => row.getAttribute('data-segment-id')),
        dragEnabled: rows.map((row) => {
          const drag = row.querySelector('.episode-note__drag')
          return drag instanceof HTMLButtonElement && !drag.disabled && drag.tabIndex === 0
        }),
        details: {
          expanded: expanded.querySelector('.episode-note__summary')?.getAttribute('aria-expanded'),
          chevron: expanded.querySelector('.episode-note__chevron')?.textContent,
          audio: Boolean(details.querySelector('.audio-player audio')
            && details.querySelector('.audio-player__speed-btn')),
          transcript: Boolean(details.querySelector('.episode-note__transcript')?.textContent?.trim()),
          moveUp: moveLabels.includes('Move up'),
          moveDown: moveLabels.includes('Move down'),
        },
        footer: {
          position: getComputedStyle(footer).position,
          left: footerRect.left,
          right: footerRect.right,
          bottom: footerRect.bottom,
          width: footerRect.width,
        },
      }
    })

    if (process.env.ADMIN_LAYOUT_SCREENSHOT && width === 360) {
      await page.screenshot({ path: process.env.ADMIN_LAYOUT_SCREENSHOT })
    }
    const overflow = layout.docScrollWidth > layout.innerWidth
      || layout.bodyScrollWidth > layout.innerWidth
      || layout.offenders.length > 0
    const denseAndAccessible = layout.rowHeights.every((height) => height >= 44 && height <= 44.5)
      && layout.touchTargets.length === 4
      && layout.touchTargets.every(({ width: targetWidth, height }) => targetWidth >= 44 && height >= 44)
    const collapsed = layout.collapsedText.every((text) => !text.includes('Listen & view transcript'))
    const detailsWork = layout.details.expanded === 'true'
      && layout.details.chevron === '⌃'
      && layout.details.audio
      && layout.details.transcript
      && layout.details.moveUp
      && layout.details.moveDown
      && layout.dragEnabled[0] === false
      && layout.dragEnabled.slice(1).every(Boolean)
      && layout.segmentOrder.join(',') === [segmentIds[0], segmentIds[2], segmentIds[1]].join(',')
    const globalStylesScoped = layout.unscopedNav.display === 'flex'
      && layout.unscopedNav.overflowX === 'visible'
    const footerFixed = layout.footer.position === 'fixed'
      && Math.abs(layout.footer.left) <= 0.5
      && Math.abs(layout.footer.right - layout.innerWidth) <= 0.5
      && Math.abs(layout.footer.bottom - (layout.innerHeight - keyboardOffset)) <= 0.5
      && Math.abs(layout.footer.width - layout.innerWidth) <= 0.5
    console.log(`${width}px scroll=${layout.docScrollWidth}/${layout.bodyScrollWidth} row=${layout.rowHeights.join(',')} targets=${layout.touchTargets.map(({ width: targetWidth, height }) => `${targetWidth}x${height}`).join(',')} footer=${layout.footer.position}:${layout.footer.width} offenders=${layout.offenders.length ? JSON.stringify(layout.offenders) : 'none'}`)
    if (overflow) failures.push(`${width}px viewport overflow`)
    if (!denseAndAccessible) failures.push(`${width}px row/touch target sizing`)
    if (!collapsed) failures.push(`${width}px collapsed row disclosure`)
    if (!detailsWork) failures.push(`${width}px details or reorder controls`)
    if (!globalStylesScoped) failures.push(`${width}px admin CSS leaks into non-admin navigation`)
    if (!footerFixed) failures.push(`${width}px fixed footer geometry`)
  }
  if (failures.length > 0) throw new Error(`Admin layout QA failed: ${failures.join('; ')}`)
} finally {
  await browser?.close()
  await server.close()
}
