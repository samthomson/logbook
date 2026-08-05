import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execFileSync } from 'node:child_process'

function localReleaseId(): string {
  if (process.env.LOGBOOK_RELEASE_ID) return process.env.LOGBOOK_RELEASE_ID
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()
    return `${commit}${dirty ? '-dirty' : ''}`
  } catch {
    return 'development'
  }
}

const releaseId = localReleaseId()

export default defineConfig({
  // Relative base so the build works on any gateway path (nsite subdomains,
  // GitHub Pages subpaths) — absolute '/' breaks under path prefixes.
  base: './',
  plugins: [
    {
      name: 'logbook-release-metadata',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{
          tag: 'meta',
          attrs: { name: 'logbook-release', content: releaseId },
          injectTo: 'head',
        }],
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'release.json',
          source: `${JSON.stringify({ release: releaseId })}\n`,
        })
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeManifestIcons: false,
      strategies: 'injectManifest',
      srcDir: 'pwa',
      filename: 'sw.ts',
      manifest: {
        id: 'logbook',
        name: 'Logbook',
        short_name: 'Logbook',
        description: 'Async voice podcast for Nostr Compass',
        theme_color: '#000000',
        background_color: '#000000',
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
      injectManifest: {
        // Keep the public reader shell and saved NIP-46 restoration offline.
        // Interactive sign-in/admin UI and large install artwork remain deferred.
        globPatterns: [
          'index.html',
          'registerSW.js',
          'manifest.webmanifest',
          'favicon.svg',
          'pwa-192x192.png',
          'assets/index-*.{js,css}',
          'assets/auth-*.js',
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
