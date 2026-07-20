# Logbook — open design questions

All questions resolved in `SPEC.md` (2026-07-20). Kept here as a record.

## 1. The async ordering problem ✓ RESOLVED

**Resolution:** Depth-first reply-forest walk. Roots in chronological order;
each root's replies in chronological order; each subtree kept contiguous before
moving to the next root. See SPEC.md §3 for algorithm and worked example.

Sub-questions resolved:
- **Default seed order:** reply-context grouping (depth-first), NOT flat chronology.
- **Intro pinning:** YES — intro segment always occupies position 0, immovable.
- **Late notes:** Auto-append to `order` tail with `newAfterLock: true` flag;
  never auto-inserted mid-list; admin sees "new" badge and decides.

## 2. Event envelope ✓ RESOLVED

**Resolution:** Kind 4200 (segment, regular/immutable), kind 34200 (manifest,
addressable). Content is JSON object (not bare URL). Required tags: `x` sha256,
`section`, `issue`. Optional: `responding_to`, `alt`. See SPEC.md §1–2.

## 3. Transcript home ✓ RESOLVED

**Resolution:** Companion event — kind 1111 scoped to the segment with
`["e", segmentId]` + `["k", "4200"]`. NOT in segment content (segment is
immutable). Short NIP-31 `alt` tag goes on the segment itself for accessibility.
See SPEC.md §5.

## 4. Name check — PENDING (action required before first publish)

"Logbook" is chosen. **Must confirm** npub, NIP-05 handle, and subdomain
availability under the Compass brand before any public-facing string is locked in.
This is blocking for the first relay publish, not for code development.
