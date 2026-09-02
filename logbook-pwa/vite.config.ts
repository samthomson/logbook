/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { requirePubkey, requireUrlList } from './src/lib/config-env.ts'

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

/** Exact client-safe names from root `.env` — not a VITE_ rename. */
const CLIENT_ENV_PREFIXES = [
  'COMPASS_PUBKEY',
  'RELAYS',
  'DISCOVERY_RELAYS',
  'BLOSSOM_SERVERS',
] as const

/**
 * NIP-05 discovery must describe the identity this bundle was built for, so it
 * is emitted from the same configuration the client validates rather than
 * tracked as a static file that can silently keep another deployment's pubkey.
 * Relay hints are DISCOVERY_RELAYS (where clients look up the identity).
 */
function nip05Plugin(env: Record<string, string>): Plugin {
  return {
    name: 'logbook-nip05',
    generateBundle() {
      const pubkey = requirePubkey(env.COMPASS_PUBKEY, 'COMPASS_PUBKEY')
      const relays = requireUrlList(env.DISCOVERY_RELAYS, 'DISCOVERY_RELAYS', 'ws')
      this.emitFile({
        type: 'asset',
        fileName: '.well-known/nostr.json',
        source: `${JSON.stringify({ names: { _: pubkey }, relays: { [pubkey]: relays } }, null, 2)}\n`,
      })
    },
  }
}

const testEnv = {
  // Distinct from 'a'.repeat(64), which several unit tests use as a non-Compass key.
  COMPASS_PUBKEY: 'b'.repeat(64),
  RELAYS: 'wss://relay.test',
  DISCOVERY_RELAYS: 'wss://discovery.test',
  BLOSSOM_SERVERS: 'https://blossom.test',
}

export default defineConfig(({ mode }) => ({
  // Relative base so the build works on any gateway path (nsite subdomains,
  // GitHub Pages subpaths) — absolute '/' breaks under path prefixes.
  base: './',
  // Expose the same names as `.env` / the worker. Prefixes are the full names
  // so COMPASS_BUNKER_DIR is not pulled into the client bundle.
  envPrefix: [...CLIENT_ENV_PREFIXES],
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
    nip05Plugin(loadEnv(mode, process.cwd(), '')),
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
  test: {
    env: testEnv,
  },
}))
