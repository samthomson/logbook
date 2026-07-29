import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'

type ManifestEntry = string | { revision?: string; url: string }
declare const self: {
  __WB_MANIFEST: ManifestEntry[]
  skipWaiting(): Promise<void>
}

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()

// Register this before precacheAndRoute: Workbox uses the first matching route,
// and its precache route can otherwise map `/` to the cached index.html.
const navigation = new NetworkFirst({
  cacheName: 'html',
  networkTimeoutSeconds: 2,
})
let offlineShell: ReturnType<typeof createHandlerBoundToURL>
registerRoute(new NavigationRoute(async (options) => {
  try {
    return await navigation.handle(options)
  } catch {
    return offlineShell(options)
  }
}))

precacheAndRoute(self.__WB_MANIFEST)
offlineShell = createHandlerBoundToURL('index.html')

registerRoute(
  /^https:\/\/.*\.(webm|mp3|wav|ogg|m4a)(\?.*)?$/i,
  new CacheFirst({
    cacheName: 'audio',
    plugins: [new ExpirationPlugin({ maxEntries: 200 })],
  }),
)

registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style',
  new CacheFirst({
    cacheName: 'optional-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 24 })],
  }),
)
