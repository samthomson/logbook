# Logbook — Build Plan (draft v2, post round-1 review)

Async voice-podcast client for Nostr Compass. Locked decisions from four scoping
rounds live in `research/findings.md`; this document turns them into an event
schema, component architecture, and phased build plan. Round-1 feasibility review
findings are folded in below (see change notes marked **[R1]**).

## 1. Event schema (custom, interop is a non-goal)

Kind numbers checked against a live NIPs kind registry: 4200 and 34200 are
unregistered, and both sit in the correct NIP-01 ranges (4200 regular/immutable,
34200 addressable). Re-check against a fresh kinds dump right before coding, since
squatted-but-unregistered kinds are the only remaining collision risk.

### Segment (kind 4200, regular/immutable)

Content is a JSON object instead of a bare URL. This is a deviation from
Amethyst's NIP-A0 convention, fine since interop is a non-goal, and it keeps
parsing in one place instead of spread across tags:

```json
{
  "audio": { "url": "...", "sha256": "...", "mime": "audio/webm", "duration": 187, "waveform": [0,3,7,...] },
  "isIntro": false
}
```

**[R1] Transcript moved out of the segment's initial content.** Transcription
takes real time on longer notes (see §3 client transcription below), so the
publish flow is: upload audio to Blossom, publish the segment event immediately,
then attach the transcript once it's ready as a companion event
`["e", "<segmentId>"]` + `["k", "4200"]` pointing back at the segment. The
segment stays immutable; the transcript arrives asynchronously and clients merge
it in.

**[R1] Add an `x` tag alongside the JSON content:** `["x", "<sha256>"]`. Blossom
retention/GC tooling scans events for referenced hashes, and burying the hash
inside JSON content makes those blobs invisible to that tooling. This one tag
keeps the JSON-content design compatible with that convention.

**[R2] This supersedes the earlier imeta lock.** `research/findings.md` originally
locked "keep the imeta audio-blob convention." JSON content and NIP-92 `imeta`
are mutually exclusive (imeta requires the URL to appear in `content`), so the
`x`-tag approach above replaces that lock. Recorded here as the current decision;
findings.md carries a pointer to this section.

Tags:
- `["x", "<sha256>"]` — required, see above
- `["section", "<stable-section-id>"]` — required, links to manifest section
- `["issue", "logbook-31"]` — which weekly issue, useful for indexing
- `["responding_to", "<event-id>"]` — optional soft pointer, rendered as an "in
  reply to" chip, never creates structural thread depth (the Airchat lesson)

Author pubkey is the contributor npub, or the Compass npub for AI-intro segments.

### Issue manifest (kind 34200, addressable, d-tag = issue id)

Nostr's addressable-event replacement coordinate is `(kind, pubkey, d-tag)`, so an
attacker publishing kind 34200 with the same d-tag from a different pubkey
creates a different coordinate on a compliant relay. It can never overwrite the
real manifest at the relay level.

**[R1] The one real hole is client query construction.** A filter on
`{kinds:[34200], "#d":["logbook-31"]}` with no `authors` filter returns any
manifest with that d-tag, including an attacker's. Every manifest query in the
client and VPS must pin `authors: [compassPubkey]`, and the client re-verifies
the returned event's pubkey before treating it as authoritative. That is the
entire write-authority mechanism, no extra ACL layer needed.

Content:

```json
{
  "issueRef": "<naddr of the kind 30023 Compass issue>",
  "episodeStatus": "draft | cutting | published",
  "sections": [
    {
      "id": "sec-<slug>-31",
      "title": "Project Name",
      "introEventId": "<segment id, always position 0>",
      "order": ["<segmentId1>", "<segmentId2>", "..."]
    }
  ],
  "publishedRss": { "guid": "...", "chapters": [...] }
}
```

### "Made the cut" marker

Reuse the standard kind 7 reaction (content e.g. `🎙️`) from the Compass npub on
segment ids included in the published episode. Free interop bonus: any Nostr
client renders it as a normal like.

## 2. The ordering model (resolves the async-ordering problem)

- Section is the only cross-note ordering key. Global `created_at` plays no role
  across sections; sections play in newsletter H2/H3 order.
- Within a section, the manifest's `order` array is the actual edit-decision-list
  the stitcher concatenates, distinct from raw chronology.
- **[R1] Seed order, precisely defined:** treat each section's segments as a reply
  forest (roots = segments with no `responding_to`, or whose `responding_to`
  target lives outside this section). Walk it depth-first: roots in chronological
  order, each root's replies in chronological order, each subtree kept contiguous
  before moving to the next root. Worked example — A (t1), B replies to A (t2), C
  unrelated (t3), D replies to B (t4): seed order is A, B, D, C. The B subtree
  stays whole; C is a second root and sorts after it. This generalizes cleanly
  when two segments reply to the same parent (siblings, chronological among
  themselves) and is immune to cycles since `responding_to` always points at a
  hash that already exists.
- The author can drag-reorder the seed at any time; the manifest's `order` array
  is what the stitcher actually reads, not the live seed computation.
- Intro segment is always pinned to position 0 of its section.
- Notes recorded after the author starts cutting auto-append to the section's
  `order` tail with a "new" flag in the client UI. They are never auto-inserted
  mid-list, so a curated cut never silently shifts.

## 3. Components

### A. PWA client (React + Vite, static build, GitHub Pages under the Compass domain)

- **Auth:** NIP-46 bunker URI (primary, all platforms), NIP-55/Amber intent
  (Android only), nsec/ncryptsec paste (behind an "advanced" toggle, discouraged
  in copy).
- **Issue ingest:** query relays for the latest Compass kind 30023 from the known
  Compass npub, parse H2 into a section and H3 into a sub-item, the same split
  Compass already uses for its own publish step.
- **Whitelist:** client fetches a static per-issue JSON (generated by the existing
  `publish/dm-outreach.ts`, published alongside the PWA build) mapping section id
  to allowed npubs. Record UI is hidden for pubkeys outside that list. This is a
  UI filter only; relay and Blossom access stay public, per the locked decision.
  **[R3]** The raw per-issue list would drop a contributor the week they aren't
  mentioned, which reads as being uninvited rather than intended gating. The
  validation roster is the union of Compass-signed standing/per-issue lists and
  every npub in the current canonical revision of each signature-verified
  Compass newsletter.
  Any authenticated npub can record under any section; unvalidated notes remain
  visible to producers but cannot enter the cut. The section map is a UI
  suggestion, not a gate.
- **Recording:** `MediaRecorder` (webm/opus), local waveform + trim before upload.
  **[R2]** iOS below 18.4 has no WebM/Opus recording support and no wake-lock
  inside an installed PWA, so a long take can be cut short by screen lock. Set
  iOS 18.4 as the supported floor for recording; older iOS gets a clear
  in-app notice rather than a silent failure.
- **[R1] Transcription, re-sequenced:** transformers.js Whisper-base (WebGPU where
  available — iOS 26+, Chrome/Android; WASM fallback elsewhere at roughly
  0.5-1.5x real time) runs in a Web Worker *after* the audio has already uploaded
  and the segment event has already published. A 3-minute note costs 2-6 minutes
  of WASM compute; a 30-minute note costs 20-60 minutes, well past the point a
  phone screen would otherwise lock and suspend the worker. Gating upload on
  transcription risked losing the take entirely, so the flow is now: record →
  upload → publish segment → transcribe in the background → publish the
  companion transcript event when done. A VPS-side Whisper job also runs as a
  fallback for any segment whose client-side transcription job aborts (tab
  closed, backgrounded past its budget) or that exceeds a length threshold.
- **Upload:** Blossom kind 24242 auth, BUD-04 mirror to the VPS-hosted origin plus
  one or two public servers. **[R1]** Each mirror target needs its own fresh
  24242 auth (or one auth tagged for all target servers); mirrors pull from the
  source URL, so the VPS origin must be reachable over public HTTPS with CORS and
  byte-range support enabled.
- **Timeline UI:** sections in newsletter order, notes in the current EDL/seed
  order, transcript-first rendering (tap to play the audio, the Airchat/
  VoiceThread lesson), reply context shown as a flat "in reply to" chip instead of
  an indented tree.
- **Admin mode** (Compass npub / configured admin keys only): drag-to-reorder,
  include/exclude toggle per segment (and per section, see the stitcher note
  below), "lock episode" action that flips `episodeStatus` to `cutting` and
  signals the VPS stitcher. **[R3]** Cutting a 90-minute episode from 50-100
  clips means the author listens to well over 90 minutes of raw audio before
  deciding anything, and v1 ships without transcription, so that listening is
  the real weekly cost, not the drag-to-reorder mechanics. Budget 2-3 hours of
  weekly review time for v1, and add 1.5-2x playback speed plus a per-segment
  reviewed/unreviewed marker to make that pass faster; transcript-first curation
  in v2 is the actual fix and a reason not to let that release slip.

### B. VPS (admin Nostr client and production pipeline, holds the Compass hot key)

- **Weekly cron:** on a new Compass issue publish, parse sections, create the
  draft manifest (empty `order` arrays), sign and publish with the Compass npub.
- **Whitelist export:** run `dm-outreach.ts`, emit the per-issue JSON, ship it
  with the PWA static build.
- **AI intro:** pull section prose from the existing Compass pipeline (already
  behind the anti-slop and claim-verification gates), write a 30s-3min
  spoken-register script, TTS (Kokoro local, ElevenLabs BYOK optional later),
  upload to Blossom, publish as a segment with `isIntro: true`, signed by the
  Compass npub.
- **[R1] Stitcher, corrected to a three-stage pipeline:**
  1. Per clip: two-pass EBU R128 loudnorm (a single pass is a dynamic mode that
     pumps on speech; accurate loudnorm needs a measurement pass, then an apply
     pass with the measured values), plus edge silence-trim, normalized to a
     common sample rate/channel layout, output to WAV.
  2. Per section: concat the section's clips in manifest `order`.
  3. Across sections: chain `acrossfade` pairwise across the section files (it
     only accepts two inputs at a time, so a single filter graph covering every
     clip in the episode was never viable at 50-100 clips), encode the result to
     mp3, and derive `podcast:chapters` from the same clip boundaries, named per
     contributor.
  4. **[R3]** With roughly 35 H3 items per issue and a small contributor pool,
     many sections will carry only the intro and no replies. A section whose
     `order` contains no contributor segment is excluded from the episode by
     default (the section-level exclude toggle from admin mode overrides this
     if the author wants it in anyway); an intro is never carried over to a
     later issue waiting for replies that never came, consistent with the
     locked "silent omission is fine" call.
- **[R1] Fallback Whisper transcription** for segments whose client-side job
  aborted or exceeded the length threshold (see client transcription above).
- **RSS publish:** write and update the Podcasting 2.0 feed XML, host both the
  feed and the episode mp3 on the VPS's own HTTPS origin (see §5, item 1),
  confirm byte-range requests are served (nginx does this by default, and
  podcast apps rely on it), then post a NIP-73-scoped kind 1111 note from the
  Compass npub so the episode surfaces in Fountain's discussion view.

## 4. Phased build plan

- **Pre-v0 checklist:** **[R2]** confirm "Logbook" npub/handle/domain
  availability under the Compass brand (open-questions.md item 4) before any
  public-facing string locks in.
- **v0 spike (about a week):** prove the core loop only — NIP-46 login, fetch one
  Compass issue, list sections, record one note, upload to Blossom, publish the
  segment event, play it back. Skip the manifest, whitelist, transcription, and
  stitching entirely at this stage.
- **v1 MVP:** full timeline/recording/threading UI, authenticated recording with
  separate Compass-controlled cut validation,
  VPS-generated manifest, admin drag-to-reorder, manual VPS-triggered stitcher,
  one produced episode published to Podcasting 2.0 RSS by hand to prove the
  format. PWA installable and published through nsyte/nsite; RSS and episode
  media remain on the trusted HTTPS origin.
  Transcription, AI intro, and voice changer wait for v2/v3, matching the
  "none required for MVP" call. **[R2]** With transcription deferred, the v1
  timeline shows waveform and duration per note (transcript-first rendering
  activates once v2 ships transcription). Late-arriving notes append plainly
  to the section tail; the "new" badge and admin notification arrive with v2.
  **[R3]** Two policies made explicit for v1: a published episode is immutable,
  so a note recorded after `episodeStatus` flips to `published` stays in that
  issue's thread only and rolls into the next issue's outreach rather than
  reopening the episode; and the app ships a read-only issue picker listing
  past kind 34200 manifests from the Compass pubkey, with each issue's whitelist
  JSON versioned rather than overwritten, so past threads stay browsable even
  though the RSS feed (not the app) is the actual episode archive.
- **v2:** client-side transcription (with the VPS fallback) feeding transcript
  display and search, the AI intro pipeline wired end to end, automatic
  chapters/transcript in the RSS, the "made the cut" reaction, auto-append-to-tail
  for late notes. **[R2]** Same release also adds a short-form summary in a
  NIP-31 `alt` tag on the segment event, so clients that can't play audio still
  show useful text (the accessibility half of open-questions.md item 3).
- **v3:** voice changer (pitch/formant "disguise" mode plus a
  transcribe-then-TTS "strong" mode), `podcast:value` Lightning splits (needs a
  new whitelist field for contributor Lightning addresses, separate from npubs),
  an auto-triggered stitcher on "lock episode" replacing the manual VPS command,
  and multi-gateway nsite resilience with release-by-release gateway verification.

## 5. Items resolved by round-1 review, carried forward as confirmed design

1. **Episode mp3 + RSS location, confirmed.** A 90-minute mp3 at 128kbps is
   86.4MB. GitHub blocks pushes over 100MB per file, warns at 50MB, recommends
   repos stay under 1GB, and caps a published Pages site at 1GB with a 100GB/month
   soft bandwidth limit; Pages' own policy excludes content distribution as a use
   case. Weekly episodes would blow the 1GB cap within about three months. Fix
   confirmed: the PWA static shell is a content-addressed nsyte/nsite release;
   the episode audio and feed.xml live on the VPS's own HTTPS origin
   (already serving as the Blossom origin). A 96kbps mono encode is available as
   a size-margin option if needed.
2. **`podcast:value` needs contributor Lightning addresses**, which the
   whitelist doesn't collect today, npub only. Stays in v3; flagged here so it
   isn't assumed to ship free with the chapters work in v2.
3. **Content-as-JSON vs Amethyst's bare-URL-content convention:** kept, with the
   `x` sha256 tag added (see §1) so hash-scanning tooling still works.
