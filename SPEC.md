# Logbook — Event Specification

This is the canonical spec for all Nostr events used by Logbook. PLAN.md §1–2
contains the rationale; this document is the authoritative, code-ready reference.
Do not deviate from this spec without updating it first.

---

## Open Questions Resolution

All open questions from `research/open-questions.md` are resolved here:

1. **Default within-section seed order:** depth-first reply-forest walk (see §3).
   Roots in chronological order; each root's replies in chronological order; each
   subtree kept contiguous before moving to the next root.

2. **Intro track pinning:** YES. The intro segment always occupies position 0 in
   its section's `order` array. It is immovable.

3. **Late notes (recorded after author starts cutting):** Auto-append to the
   section's `order` tail with `newAfterLock: true` flag in the manifest. They
   are never auto-inserted mid-list. Admin UI shows a "new" badge. The author
   decides whether to pull them into the cut.

4. **Transcript home:** Companion event (kind TBD, `["e", segmentId]` +
   `["k", "4200"]`). NOT in segment content. Segment content is immutable.

5. **NIP-31 alt tag:** A short plain-text summary goes in `["alt", "..."]` on
   every segment event for accessibility (first 280 chars of transcript once
   available, else `"Voice note on: <section title>"`).

---

## §1. Segment Event (kind 4200)

Regular event — immutable after publish.

### Content

JSON string:

```json
{
  "audio": {
    "url": "https://blossom.example/abc123.webm",
    "sha256": "abc123...",
    "mime": "audio/webm",
    "duration": 187,
    "waveform": [0.0, 0.12, 0.45, 0.8, 0.6, 0.3, 0.05]
  },
  "isIntro": false
}
```

- `audio.url` — HTTPS URL to the Blossom blob
- `audio.sha256` — hex sha256 of the raw audio file (same value as `x` tag)
- `audio.mime` — always `"audio/webm"` for contributor segments; may be `"audio/mpeg"` for AI intro TTS
- `audio.duration` — seconds (integer or float, 2 decimal places max)
- `audio.waveform` — amplitude array normalized to 0–1 floats, ~100 samples, used for waveform thumbnail rendering (clients MUST clamp at render; values >2 on ingest should be assumed 0–255 scale and downscaled)
- `isIntro` — `true` only for AI-generated intro segments signed by the Compass npub

### Required Tags

| Tag | Example | Notes |
|-----|---------|-------|
| `["x", "<sha256>"]` | `["x", "abc123..."]` | Required for Blossom GC tooling |
| `["section", "<id>"]` | `["section", "sec-bitcoin-31"]` | Stable section ID (see §4) |
| `["issue", "<id>"]` | `["issue", "logbook-31"]` | Issue identifier |

### Optional Tags

| Tag | Example | Notes |
|-----|---------|-------|
| `["responding_to", "<eventId>"]` | `["responding_to", "deadbeef..."]` | Soft reply pointer; UI renders as chip, no tree depth |
| `["alt", "<text>"]` | `["alt", "Voice note on: Bitcoin"]` | NIP-31 plain-text summary for accessibility |

### Author

- Contributor segments: contributor's npub
- AI intro segments: Compass npub (signed on VPS)

---

## §2. Issue Manifest (kind 34200)

Addressable event — replacement coordinate is `(34200, compassPubkey, d-tag)`.

**Security rule:** Every relay query MUST include `authors: [compassPubkey]`.
The client MUST re-verify `event.pubkey === compassPubkey` before treating the
event as authoritative. A spoofed manifest from a different pubkey with the same
d-tag is a different coordinate on the relay — it cannot overwrite the real one,
but a filter without `authors` would return it.

### d-tag

`logbook-<issueNumber>` e.g. `logbook-31`

### Content

JSON string:

```json
{
  "issueRef": "<naddr of the kind 30023 Compass issue>",
  "episodeStatus": "draft",
  "sections": [
    {
      "id": "sec-bitcoin-31",
      "title": "Bitcoin",
      "introEventId": "<eventId or null>",
      "order": ["<segmentId1>", "<segmentId2>"],
      "excluded": [],
      "reviewed": []
    }
  ],
  "publishedRss": null
}
```

Fields:

- `issueRef` — naddr pointing to the Compass kind 30023 event
- `episodeStatus` — `"draft"` | `"cutting"` | `"published"` (published is terminal/immutable)
- `sections[].id` — stable section ID (see §4)
- `sections[].title` — human-readable title from newsletter H2
- `sections[].introEventId` — event ID of the AI intro segment for this section, or null
- `sections[].order` — ordered list of segment event IDs; this is what the stitcher reads
- `sections[].excluded` — segment event IDs excluded from the cut (greyed in admin view)
- `sections[].reviewed` — segment event IDs marked as reviewed by admin
- `publishedRss` — null until published; then `{ "guid": "...", "mp3Url": "...", "chapters": [...] }`

### Manifest Tags

| Tag | Example |
|-----|---------|
| `["d", "<issueId>"]` | `["d", "logbook-31"]` |
| `["title", "<title>"]` | `["title", "Logbook Episode 31"]` |

---

## §3. Seed Order Algorithm

Used to populate `sections[].order` when the manifest is first created (before any admin drag-reorder).

```
function computeSeedOrder(segments: Segment[]): string[] {
  // 1. Build a map of eventId → segment
  // 2. Identify roots: segments with no responding_to, OR whose responding_to
  //    target is outside this section
  // 3. Sort roots chronologically by created_at
  // 4. For each root, depth-first walk:
  //    a. Emit root
  //    b. Find direct replies (responding_to === root.id), sort by created_at
  //    c. For each reply, recurse (emit reply, find its replies, etc.)
  // 5. Return flat array of event IDs in walk order
}
```

Worked example:
- A (t=1, root)
- B (t=2, replies to A)
- C (t=3, root)
- D (t=4, replies to B)

Seed order: `[A, B, D, C]` — B's subtree (B→D) stays contiguous before C.

Cycle safety: `responding_to` always points to a pre-existing event ID, so cycles
are impossible (the referenced event must exist before the reply is created).

The intro segment (introEventId) is always moved to position 0 after seed order
computation, regardless of its `created_at`.

---

## §4. Section ID Format

Section IDs are stable across manifest updates. Format:

```
sec-<slug>-<issueNumber>
```

Where `<slug>` is the H2 section title slugified:
- Lowercase
- Spaces → `-`
- Non-alphanumeric characters removed (except `-`)
- Truncated to 40 chars before appending `-<issueNumber>`

Examples:
- H2 `## Bitcoin` in issue 31 → `sec-bitcoin-31`
- H2 `## Lightning Network` in issue 31 → `sec-lightning-network-31`
- H2 `## AI & Machine Learning` in issue 31 → `sec-ai-machine-learning-31`

---

## §5. Companion Transcript Event

Kind: not yet assigned (use kind 1111 with `["k", "4200"]` for now, or a custom
kind — decision: use kind 1111 scoped to the segment).

```json
{
  "kind": 1111,
  "content": "<full transcript text>",
  "tags": [
    ["e", "<segmentEventId>", "", "root"],
    ["k", "4200"],
    ["alt", "Transcript of voice note"]
  ]
}
```

Author: same as the segment author (client-side transcription) or Compass npub
(VPS fallback transcription).

---

## §6. Kind 7 "Made the Cut" Reaction

The Compass npub publishes a standard kind 7 reaction on each segment event ID
included in a published episode:

```json
{
  "kind": 7,
  "content": "🎙️",
  "tags": [
    ["e", "<segmentEventId>"],
    ["p", "<segmentAuthorPubkey>"]
  ]
}
```

---

## §7. Kind Collision Check

Before publishing any events:
- Kind 4200: check https://github.com/nostr-protocol/nostr/blob/master/README.md
  or the live kind registry. As of 2026-07-20: unregistered.
- Kind 34200: same check. As of 2026-07-20: unregistered.

Re-check immediately before the v0 spike goes live. Squatted-but-unregistered
is the only remaining collision risk.

---

## §8. Relay Configuration

Default relays (configurable in `src/config.ts`):

```
wss://relay.damus.io
wss://relay.nostr.band
wss://nos.lol
wss://relay.snort.social
```

All manifest queries MUST include `authors: [compassPubkey]` filter.
All segment queries for a section MUST include `#section: [sectionId]` filter.

---

*Spec version: 1.0 — 2026-07-20*
