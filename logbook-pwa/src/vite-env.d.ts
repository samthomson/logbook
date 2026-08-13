/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly COMPASS_PUBKEY: string
  readonly ADMIN_PUBKEYS: string
  readonly RELAYS: string
  readonly DISCOVERY_RELAYS: string
  readonly BLOSSOM_SERVERS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
