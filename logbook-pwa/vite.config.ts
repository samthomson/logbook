import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Relative base so the build works on any gateway path (nsite subdomains,
  // GitHub Pages subpaths) — absolute '/' breaks under path prefixes.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Logbook',
        short_name: 'Logbook',
        description: 'Async voice podcast for Nostr Compass',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        // index.html must always come from network so new deploys take effect
        // (nsite gateways also cache, but SW revalidate wins when online)
        navigateFallbackDenylist: [/^\/assets\//],
        runtimeCaching: [
          {
            // Audio blobs: cache-first (immutable content-addressed by sha256)
            urlPattern: /^https:\/\/.*\.(webm|mp3|wav|ogg|m4a)(\?.*)?$/i,
            handler: 'CacheFirst',
            options: { cacheName: 'audio', expiration: { maxEntries: 200 } },
          },
          {
            // HTML navigations: network-first so deploys propagate; fall back
            // to precached shell offline
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'html' },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
