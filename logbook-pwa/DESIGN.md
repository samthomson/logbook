# Logbook UI — minimal design system

One file of tokens (`src/index.css`), one product stylesheet (`src/App.css`),
admin extras in `src/components/AdminWorkspace.css`. No icon fonts, no Google
Fonts, no component libraries.

## Principles

1. **System type** — `system-ui` stack. No custom webfonts.
2. **Few colors** — background, text, muted, line, accent, danger.
3. **One column** — content max-width `36rem`, centered, `1rem` page padding.
4. **Spacing** — multiples of `4px` only (`4 / 8 / 12 / 16 / 24 / 32`).
5. **No decoration** — no gradients, glows, shadows-as-style, hairline rules as
   section art. Borders only where they separate interactive regions.
6. **Fail closed visually** — missing profile → “Contributor”, not hex cosmetics.

## Tokens

| Token        | Role                                      |
|--------------|-------------------------------------------|
| `--bg`       | Page background                           |
| `--fg`       | Body text                                 |
| `--muted`    | Secondary text                            |
| `--line`     | Borders / dividers                        |
| `--surface`  | Slightly raised blocks (notes, panels)    |
| `--accent`   | Primary actions and active nav            |
| `--danger`   | Errors / record                           |
| `--radius`   | `6px` everywhere                          |
| `--pad`      | Page horizontal padding (`1rem`)          |
| `--measure`  | Content width (`36rem`)                   |

## Type scale

| Name   | Size   | Use                    |
|--------|--------|------------------------|
| small  | 0.875rem | meta, captions       |
| body   | 1rem     | default               |
| title  | 1.25rem  | section headings      |
| display| 1.75rem  | issue title           |

Weight: `400` body, `600` emphasis/headings. No black/`800`.

## Components (essentials)

- **Button** `.btn` — text button; `.btn--primary` filled accent; `.btn--ghost`
  bordered; `.btn--small` denser hit target.
- **Header** `.app-header` — brand + nav + auth, same measure as content.
- **Notice** `.notice` — one-line status; warning/error/episode variants.
- **Timeline** `.timeline` — issue head, groups, sections, notes.
- **Bubble** `.bubble` — voice note: avatar + body + play/scrub/time.
- **Recorder** `.irec` — idle mic, live meters, review actions.
- **Auth / forms** — plain inputs, no card chrome.
- **Admin** — same tokens; denser lists only.

## Out of scope

Cards-as-decoration, pill clusters, emoji logos, animated backgrounds,
per-screen color themes.
