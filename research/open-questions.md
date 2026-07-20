# Logbook — open design questions

## 1. The async ordering problem (live, raised 2026-07-20)

Global chronology as the ordering principle fails. Because recording is
asynchronous, the newest voice note by `created_at` might belong to the first
newsletter topic, so sorting the whole collection by time scrambles topics and
produces an incoherent episode.

Resolution direction (to confirm when we spec the envelope):

- **Section is the primary ordering key, never global time.** The episode plays
  sections in newsletter order (H2/H3 sequence from the Compass issue). Global
  `created_at` never orders across sections.
- **Within a section, order is an explicit edit decision list (EDL), not raw
  chronology.** The weekly manifest stores, per section, an ordered list of segment
  event IDs. That list is what the VPS stitcher concatenates. The author sets it via
  drag-to-reorder. Default seed order within a section is still open: raw
  chronological-within-section, or reply-context grouping (a note and its responses
  kept adjacent).
- Every segment carries its stable section ID as a tag so a note always resolves to
  its section regardless of when it was recorded.

Open sub-questions:
- Default within-section seed order: time, or reply-context grouping?
- Does the intro track always pin to position 0 of its section?
- How do late notes (recorded after the author has cut the section) surface? Auto-
  append to the manifest tail pending author review, or held out until author pulls
  them in?

## 2. Event envelope

Custom envelope (interop is a non-goal). Needs: kind number(s), tag schema for
section ID, contributor npub, `imeta` audio block, transcript pointer, intro flag,
and the soft "responding to X" context pointer that renders without creating tree
depth. Spec this before any code.

## 3. Transcript home

Where the full transcript lives for search/AI (own manifest vs companion event) and
whether a short transcript also goes in a NIP-31 `alt` tag for accessibility.

## 4. Name check

"Logbook" is chosen. Still worth checking npub/handle/domain availability under the
Compass brand before locking public-facing strings.
