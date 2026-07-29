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
        // Keep the public reader shell offline, but do not make first install
        // compete with sign-in/admin chunks and large install artwork.
        globPatterns: [
          'index.html',
          'registerSW.js',
          'manifest.webmanifest',
          'favicon.svg',
          'pwa-192x192.png',
          'assets/index-*.{js,css}',
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
