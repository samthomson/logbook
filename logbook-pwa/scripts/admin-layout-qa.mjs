import puppeteer from 'puppeteer'
import { createServer } from 'vite'

const widths = [320, 360, 390]
const root = new URL('..', import.meta.url).pathname
const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const address = server.httpServer?.address()
if (!address || typeof address === 'string') throw new Error('Vite QA server did not expose a port')
const fixtureUrl = `http://127.0.0.1:${address.port}/scripts/fixtures/admin-layout.html`

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  const page = await browser.newPage()
  for (const width of widths) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: true })
    await page.goto(fixtureUrl, { waitUntil: 'networkidle0' })
    const summaries = await page.$$('.episode-note__summary')
    const dragHandles = await page.$$('.episode-note__drag')
    if (summaries.length !== 3 || dragHandles.length !== 3) throw new Error(`Expected 3 real recording rows at ${width}px`)
    await dragHandles[0].focus()
    await page.keyboard.press('Space')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    await page.keyboard.press('ArrowDown')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('.episode-note__author')?.textContent?.includes('2'))
    const reorderedSummaries = await page.$$('.episode-note__summary')
    await reorderedSummaries[2].click()
    await page.waitForSelector('.episode-note__details')

    const layout = await page.evaluate(() => {
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
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        rowHeights: collapsedRows.map((element) => element.getBoundingClientRect().height),
        touchTargets: targetRects.map((rect) => ({ width: rect.width, height: rect.height })),
        offenders,
        collapsedText: collapsedRows.map((row) => row.textContent ?? ''),
        authorOrder: [...document.querySelectorAll('.episode-note__author')].map((author) => author.textContent?.trim() ?? ''),
        dragEnabled: collapsedRows.every((row) => {
          const drag = row.querySelector('.episode-note__drag')
          return drag instanceof HTMLButtonElement && !drag.disabled && drag.tabIndex === 0
        }),
        details: {
          expanded: expanded.querySelector('.episode-note__summary')?.getAttribute('aria-expanded'),
          chevron: expanded.querySelector('.episode-note__chevron')?.textContent,
          audio: Boolean(details.querySelector('audio[controls]')),
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
      && layout.dragEnabled
      && layout.authorOrder[0]?.includes('2')
      && layout.authorOrder[1]?.includes('1')
    const footerFixed = layout.footer.position === 'fixed'
      && Math.abs(layout.footer.left) <= 0.5
      && Math.abs(layout.footer.right - layout.innerWidth) <= 0.5
      && Math.abs(layout.footer.bottom - layout.innerHeight) <= 0.5
      && Math.abs(layout.footer.width - layout.innerWidth) <= 0.5
    console.log(`${width}px scroll=${layout.docScrollWidth}/${layout.bodyScrollWidth} row=${layout.rowHeights.join(',')} targets=${layout.touchTargets.map(({ width: targetWidth, height }) => `${targetWidth}x${height}`).join(',')} footer=${layout.footer.position}:${layout.footer.width} offenders=${layout.offenders.length ? JSON.stringify(layout.offenders) : 'none'}`)
    if (overflow || !denseAndAccessible || !collapsed || !detailsWork || !footerFixed) process.exitCode = 1
  }
} finally {
  await browser.close()
  await server.close()
}
