# Logbook — Research Findings

Consolidated from four rounds of research (fable subagents) during scoping. These
findings lived only in the chat transcript; captured here so the working folder is
the source of truth going forward.

## What Logbook is

An asynchronous voice-podcast client tailor-made for Nostr Compass. Each week it
ingests the latest Compass issue, splits it into sections, and lets whitelisted
contributors leave voice notes under each section and respond to each other. At the
end the collection is cut together into a produced ~90-min episode published as a
Podcasting 2.0 RSS feed. Static nsite + PWA. No app-specific backend for the core
loop; a VPS acts as one more Nostr client (admin) that publishes intros and runs the
stitcher.

## Data model (voice contributions)

- **NIP-A0 is merged into nips master** — it is the shipped voice-message format on
  Nostr, not a draft PR. Kind **1222** = root voice message, kind **1244** = voice
  reply. Amethyst records these today (`quartz/nipA0VoiceMessages`); Nostur records
  and renders them too.
- Event content is the bare audio URL. Metadata rides a NIP-92 `imeta` tag: `url`,
  `m` (mime), `x` (sha256), `duration`, `waveform` (amplitude list).
- Threading is **NIP-22** (uppercase `E/K/P` = root scope, lowercase `e/k/p` =
  parent). Voice-to-voice reply = 1244; text reply to a voice note = kind 1111 with
  `K:1222`.
- Amethyst ships a `VoiceAnonymizer` (voice changer before upload) — reference impl
  for the anonymity feature.
- **Decision (locked):** we do NOT inherit Amethyst's 1222/1244 reply-tree shape.
  Interop is explicitly a non-goal — Logbook is the only intended client. We use our
  own event envelope, well-specified in this repo, and keep the `imeta` audio-blob
  convention only because Blossom and future tooling behave better with it. The exact
  envelope + ordering model is still open (see open-questions.md — the async ordering
  problem).

## Audio storage — Blossom

- Right store: sha256-addressed blobs, kind **24242** upload auth, **BUD-04**
  mirroring across servers. Well-specified, free public servers exist.
- Public servers cap upload size and **prune free blobs with no retention SLA**.
  Mitigation: run our own Blossom origin on the VPS and mirror out; treat the
  produced episode as the durable artifact.
- Any blob on a public server is world-readable to anyone with the URL — so the
  whitelist gates what the app *shows/accepts*, not who can listen. Accepted:
  client-side filtering is enough for MVP.

## Produced episode — Podcasting 2.0 RSS

- **There is no shipped Nostr podcast event kind worth using.** NIP-74 (30074/30075,
  transmit.fm) exists but is unmerged and low-adoption. Ruled out.
- Fountain and Wavlake keep the podcast in **Podcasting 2.0 RSS** and attach Nostr
  discussion via **NIP-73** external IDs (`podcast:guid`, `podcast:item:guid`) inside
  kind 1111 comments.
- **Decision (locked):** final artifact is an RSS publish. Pipeline: produce episode
  → publish Podcasting 2.0 RSS (mp3, since **Apple RSS rejects Opus**) → post a
  NIP-73-scoped note so discussion surfaces in Fountain. Do not invent a kind.
- Free wins to capture now even if shipped later: `podcast:value` split across
  contributor npubs (Fountain boosts pay contributors), and `podcast:chapters`
  entries named per contributor. Capture per-clip npub in the manifest now.

## Assembly / stitching

- ffmpeg.wasm does concat + `loudnorm` (EBU R128) + silence-trim + crossfades
  in-browser, but decoding ~1 hr of PCM is ~1.3 GB — mobile tabs die around 1-2 GB.
- **Decision (locked):** stitching is just another Nostr client, runs on the VPS.
  Phones record; the VPS assembles and publishes. Episode is a pure function of the
  manifest/EDL (see model). Author-curated final cut with drag-to-reorder; silent
  omission of cut notes is acceptable (maybe a reaction marking notes that made the
  episode).

## Transcription

- In-browser transcription is real: transformers.js Whisper-base or Moonshine over
  WebGPU, ~40-150 MB model download, near/faster-than-real-time for short clips.
- Full transcript feeds search/AI indexing and the produced show-notes. Short
  transcript can also go in a NIP-31 `alt` tag for accessibility. Exact transcript
  home = open (make it work flawlessly for our custom use).

## Hosting / distribution — nsite + PWA

- nsites are real (NIP-5A, merged); SPA web clients already run as nsites.
- **Decision (locked):** host on **GitHub Pages under the existing Compass domain**.
  PWA install, service worker, and cached drafts bind to that origin — stable domain
  removes the gateway-eviction fragility. "Publish early" is the durability story
  (drafts on Nostr/Blossom, not trusted to local storage).

## Identity / login

- **Decision (locked):** remote signers default. NIP-46 bunker primary everywhere;
  NIP-55/Amber where available (Android only — no Amber, no extensions on iOS).
  nsec/ncryptsec paste in-browser allowed but discouraged/flagged.
- iOS ≥ 18.4 is a hard capability line: below it no WebM/Opus recording, no wake-lock
  in installed PWAs (screen sleep kills a long take), worse storage. Above it iOS
  behaves.

## Whitelist

- Nearly free: Compass already maintains `data/npubs.yml` (name→npub) and
  `publish/dm-outreach.ts` emits a per-issue JSON array of everyone mentioned that
  week with npubs. That is the per-podcast whitelist, pre-computed.
- Sections split cleanly: H2 = section, H3 = one project (~35/issue); published kind
  30023 already contains `nostr:npub...` mentions.

## AI intro track

- **Decision (locked):** intro script is written on THIS machine (inside the Compass
  pipeline, behind existing anti-slop + claim-verification gates), TTS'd, and
  published by the **Compass npub** — Logbook is just the admin client that publishes
  it. The intro is one uploaded track, same shape as any other contribution;
  everyone else replies to it. TTS engine choice (Kokoro local vs BYOK ElevenLabs)
  and voice-changer are both **not required for MVP** — provide both options later.

## Segment / episode length

- **Decision (locked):** total episode target **~90 min**. Per-contribution 2-5 min
  typical, longer allowed when interesting (developer deep-dive up to ~30 min). No
  chunking of long notes — one long note, own the deviation.

## Prior art (why these apps died — design constraints)

- Airchat died partly on **deep voice-reply trees being unnavigable**. VoiceThread
  survived by capping threading to one branch and anchoring every comment to a slide.
  Our newsletter section IS that anchor — structural advantage — but a literal
  reply-tree does not linearize into an episode cleanly. Design conservatively: cap
  visible depth, transcript-first rendering.
- Racket found even 99s of stranger-audio too long. Our contributors are known
  regulars, so longer is defensible, but ten 25-min notes per section = a 4-hr
  episode nobody finishes. The author's cutting-room floor handles this.
- Anchor/SpeakPipe: being *in* the episode is the incentive that drives next week's
  recording. The thread is the participation reward; the episode is the edit.
