# Logbook — Stable Reply Threading Design

Status: proposal (2026-07-22). Scope: kind 4200 voice segments. Current state:
segments carry `["responding_to", eventId]` + `["section", sectionId]` + `["issue", issueId]`;
ordering is a depth-first reply-forest walk per `src/lib/ordering.ts`.

---

## 1. Event level — tag scheme

### Comparison

| Scheme | Query pattern | Thread root known from event? | Fit for kind 4200 |
|---|---|---|---|
| Current `responding_to` | One `#e`-style filter per parent (N queries) or client-side graph build | **No** — must walk up | Works, but no single-query thread fetch |
| NIP-10 (kind 1, root/reply/mention markers) | Single `#e` filter on root id fetches whole thread | Yes (root marker) | Wrong semantics: NIP-10 is kind-1-only, marker scheme is positional and widely mis-implemented |
| **NIP-22** (kind 1111, uppercase root `A/E/I`+`K`+`P`, lowercase parent `a/e/i`+`k`+`p`) | Single `#E` (root) filter fetches the entire thread; single `#e` (parent) fetches direct children | Yes — root always in `E` tag | Best fit. NIP-22 explicitly permits comments on non-kind-1 roots (it *forbids* replying to kind 1), which is our case |
| NIP-73 (i/k external ids) | `#i` filter | N/A | Orthogonal — for scoping to *external* things (URLs, podcast GUIDs). Could later scope threads to the Compass issue as `i`, but sections aren't global ids; skip |

### Recommendation: adopt NIP-22-style dual tagging on kind 4200, keep `responding_to` as legacy

For every new reply segment, publish **both**:

```
["responding_to", parentId]                      // legacy, keep until migration done
["E", rootSegmentId, relayHint, rootAuthorPubkey]
["K", "4200"]
["P", rootAuthorPubkey, relayHint]
["e", parentId, relayHint, parentAuthorPubkey]
["k", "4200"]
["p", parentAuthorPubkey, relayHint]
```

For a top-level (root) segment, omit `E/e/...` entirely (or emit `E == own id` — cleaner to omit; roots are defined as "no parent tags").

Why not just use kind 1111 comments? Segments are the *primary content* (audio payload in content JSON), not comments on it. Reusing kind 4200 keeps one fetch path; NIP-22's tag *conventions* give us the query pattern without changing kinds.

**Relay query patterns unlocked:**
- Whole thread of a root: `{kinds:[4200], "#E":[rootId]}` — one filter. (Today impossible; requires full-section fetch + client graph.)
- Direct children of X: `{kinds:[4200], "#e":[X]}` — used for lazy reply counts.
- Section batch stays as-is (`#t` on issue id, group client-side) — unchanged, still one query per issue.

Root resolution: root = walk `e`/`responding_to` up until absent; with dual tags the client can cache `rootId` at parse time and never re-walk. Note NIP-22 requires the root id *at publish time* — publisher must walk up from parent using loaded segments; if parent was loaded via our section fetch, its `E` tag (or absence) gives the root in O(1).

Relay hints: include the relay the parent was fetched from — materially improves cross-relay fetchability.

---

## 2. Data level — deterministic ordering

Keep the depth-first forest walk (it's good), but harden the inputs:

**Ordering key.** Sort siblings by `(created_at, id)` — created_at ties happen (same-second posts) and id tiebreak makes the order fully deterministic across clients.

**Late parents / missing parents.**
- A reply whose parent isn't in the fetched set is treated as a root (current behavior — correct).
- Refinement: when a segment arrives later whose id is some known segment's parent (parent arrives *after* child), re-run `computeSeedOrder` on the affected section — cheap (section sizes are small) and idempotent. Don't patch the order incrementally; recompute. Recompute is the stability guarantee: the final order must be a pure function of the segment *set*, never of arrival order.
- Parents on another relay: the `e`-tag relay hint lets us issue a targeted `{ids:[parentId]}` fetch for the quote preview. While missing, show "reply to an unavailable note" placeholder (see §3) — never crash the walk; child renders as root until parent resolves, then recompute moves it under the parent. Acceptable transient reorder; document it.

**Duplicate segments.** Same id from multiple relays: dedupe by id at ingest (first-write-wins into a `Map<string, Segment>` — already the case in `computeSeedOrder`; ensure ingest does the same before rendering). "Duplicate content, different id" (user double-published): not dedupeable at data level — handle via UI delete/exclude, not ordering.

**Legacy section ids.** Known bug class: segment's stored `section` tag ≠ its displayed home. Rule: a segment's home section is decided by **scanning loaded sections for the event id** (as fixed for the recorder bug), and the ordering walk must operate on that *resolved* grouping, not on tag values. Centralize: one `resolveSection(segment, sections)` helper used by timeline, recorder targeting, and ordering — never compare `segment.sectionId === X` directly anywhere.

**Cycle safety.** With dual tags, a malformed `E` (root) pointing into a cycle is possible. The walk is already visited-set protected; also ignore any `e` parent that equals self or a descendant (cheap check during graph build).

**Intro pinning.** Keep as post-pass (position 0). Intros can never be reply parents for ordering purposes — reject reply-to-intro at publish (UI already hides reply button on intro; enforce in `publishSegment` too).

---

## 3. UI level — flat timeline reply context

Keep the flat Telegram-style layout (no indentation). Per-bubble:

1. **Quote preview** above the bubble body: one-line strip with parent author name + first ~6 words of transcript (or "🎤 0:42 voice note" when no transcript) + parent's waveform thumbnail. Tappable. When parent is missing: dimmed strip "reply to an unavailable note" (non-tappable, with a subtle retry icon that re-fires the targeted ids fetch).
2. **Tap-to-scroll**: tapping the quote scrolls the parent into view (smooth scroll + brief highlight flash, ~1.2s background tint). If parent is in a different (collapsed) section, expand that section first, then scroll. If parent truly absent (other relay, fetch failed), show toast "parent note not found on your relays".
3. **Depth limit**: replies are always to a specific bubble, but *visually* flat means depth is unbounded without cost. Still cap **publish** depth at ~3: deeper reply buttons retarget to the depth-2 ancestor with a hint ("replying to <name>'s thread") — prevents degenerate chains and keeps the quote-strip context meaningful. The `e` tag still points at the true parent; only the affordance is capped.
4. **Pending state**: on publish, insert an optimistic bubble immediately at the walk-correct position (computed against local set) with a clock/spinner badge and 80% opacity; swap to confirmed on first relay OK; on total failure flip to an error state with inline "Retry / Discard" — recording blob retained in memory. Never lose audio silently (established rule).
5. **Reply counts**: small "↩ N" affordance on bubbles, count from client graph; tapping filters/scrolls to first child. Optional, v2.

---

## Migration path

Phase 1 (additive, zero breakage):
- `publishSegment` emits dual tags (`responding_to` + NIP-22 set). Parse: prefer `e` tag, fall back to `responding_to`. Root cache: prefer `E`, else walk.
- Ship. Old clients fully compatible.

Phase 2 (read-side):
- Ordering/quote code uses cached `rootId`; targeted parent fetch via `e`-hint relays.
- Thread fetch (`#E`) used for future "view thread" view; section fetch unchanged.

Phase 3 (cleanup, only when relays/indexers show >95% dual-tagged, or never — `responding_to` is harmless):
- Optionally stop emitting `responding_to`. No data rewrite possible/needed — old events keep legacy tag and keep working via fallback forever.

Edge case to handle during transition: a new client replies to an *old* parent (no `E` tag). Publisher walks up via `responding_to` chain to compute root — fine since parent is loaded locally. If chain hits a missing event mid-walk, publish `E` = deepest known ancestor; ordering still correct because ordering uses parent (`e`), not root.
