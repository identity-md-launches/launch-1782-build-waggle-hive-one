# Waggle Hive design system

## Overview

Waggle Hive is a live observation tool for people following the IMD agent swarm. One honeycomb carries the visual idea: each numbered seat has a fixed place, accepted work adds heat, and active work glows. The surrounding interface uses restrained surfaces, explicit labels, and stable numbers. The heading and finder precede the map; the seat panel follows it at every width.

The implementation is one HTML page, plain TypeScript, and one map with two canvas layers. The transparent layer exists only for working-seat glow. There is no UI framework, router, remote font, or remote image. Canonical styles are in [`src/style.css`](src/style.css); geometry and rendering are in [`src/geometry.ts`](src/geometry.ts) and [`src/map.ts`](src/map.ts).

## Colors

These semantic custom properties are declared on `:root`; `prefers-color-scheme: dark` switches them live. Canvas colors are read from the same properties.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--page` | `#f6f5f2` | `#0b0b0c` | Page background |
| `--card` | `#ffffff` | `#141416` | Cards, fields, secondary buttons |
| `--border` | `#e2e0da` | `#2a2a2e` | Structural borders and empty bars |
| `--text` | `#1c1c1e` | `#f2f1ee` | Primary text, selected cell ring |
| `--muted` | `#6b6b70` | `#9a9a9f` | Labels, times, secondary copy |
| `--ember` | `#bd3f0b` | `#ff9a5c` | Heat, working status, Go button, focus |
| `--on-ember` | `#ffffff` | `#1c1c1e` | Go button text |
| `--idle-stroke` | `#b4b1a9` | `#49494e` | Unfilled lattice cells |
| `--rejected` | `#8c8782` | `#99959a` | Rejected segment of outcome bar |
| `--failed` | `#d5d1ca` | `#4b484e` | Failed segment of outcome bar |

The heat fill is ember at `0.18 + 0.57 × log10(accepted + 1) / log10(maxAccepted + 1)`. Zero or unavailable accepted counts leave an outline. Working cells use full ember and a glow. Text, numbers, and the seat status provide a non-color way to read the selected cell; the finder provides an alternative to small cell targets.

Measured from the rendered CSS values: muted text on the page is **4.86:1 light / 7.02:1 dark**; muted text on cards is **5.30:1 / 6.57:1**. Go button text is **5.41:1 / 8.13:1**. Ember focus on cards is **5.41:1 / 8.79:1**. The heat ramp is a data visualization, not text; its individual alpha steps are not claimed to satisfy text contrast.

## Typography

The system stack is `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No font assets are loaded. Weights are 400 and 600; all numbers use `font-variant-numeric: tabular-nums`.

| Token | Size | Role |
| --- | --- | --- |
| `--small` | 13px / 0.8125rem | Labels, event text, metadata, footer |
| `--body` | 16px / 1rem | Body, inputs, primary button |
| `--heading` | 20px / 1.25rem | Card headings, close glyph |
| `--stat` | 32px / 2rem | Four principal counters |
| `--display` | 56px / 3.5rem; 40px / 2.5rem at ≤36rem | H1 and selected accepted count |

That is five sizes at any viewport and six across the responsive system. Body line-height is 1.5; H1 is 1.08 with −0.05em tracking; H2 is 1.3 with −0.02em tracking. Stat numbers use 1.1 / −0.025em, and the selected count uses 1 / −0.04em. Headings balance; the intro and footer use pretty wrapping. Inputs stay at 16px. Event words can wrap anywhere, and essential data is not ellipsized.

## Layout

`--space: 16px` separates cards and supplies their internal padding. Related details generally use 8px, then 12px, 20px, 24px, or 32px where grouping needs more room. The outer `.page` is at most 1184px including its padding: 32px each side on desktop, 24px at ≤56rem, 16px at ≤36rem.

The stats grid is four equal columns and becomes two at ≤36rem. Compact statistics wrap on desktop, use two columns on phones, and stack their individual label/value pairs at ≤22rem. The finder sits above the map with refresh information at the other edge. At phone widths the refresh line sits below it; at ≤22rem the field label and controls stack.

The map, legend, and seat panel span the full content width as direct children of `main`, separated by 16px top margins; the two-column `.pair-grid` holds only Busiest seats and Latest, side by side above 56rem and stacked in that order below. The selected panel's content uses three columns on desktop and one on smaller screens. On phones/tablets ≤56rem, the open panel is bottom-sticky, inset by at least 8px or the safe area, capped at 45dvh (45vh fallback), and internally scrollable with a sticky title/close row. Because its sticky containing block is `main` rather than a grid, it reaches the bottom inset at every page scroll position; after a tap or a Go/Busiest/Latest selection the page scrolls so the chosen cell sits in the viewport area above the panel.

The map's scroll viewport is capped at 690px on desktop, 520px at ≤56rem, and 400px at ≤36rem. The entire 2,000-cell canvas is drawn at once; vertical scrolling reveals the remaining rows. It reserves 4px of internal lattice padding. Column count is `clamp(floor((width − 8) / 14 − 0.5), 16, 40)`; odd rows offset half a pitch. Hit testing uses CSS pixels independently of raster density. Raster DPR is capped at 3.

Rendered checks covered 320, 390, 768, 1024, and 1440px in both themes with no horizontal overflow. Native zoom and physical-device behavior were not tested.

## Elevation & depth

Surfaces are flat, with 1px structural borders and no card shadows. The only glow is on working map cells. The hover tooltip is at z-index 5; the mobile selected panel is at z-index 10 with an opaque card background. The working canvas has no pointer events and does not intercept input. The panel is a nonmodal region, so there is no background scrim or focus trap.

## Shapes

Cards use `--radius: 12px`, fields/buttons 8px, seat chips 5px, and small bars 4px. The canvas uses pointy hexagons drawn at 90% of the layout radius to leave breathing room; the selected ring is at 104%. A seven-cell ember SVG supplies the favicon and wordmark icon. The 1200×630 PNG is generated offline from canvas drawing commands in `scripts/generate-og.mjs`.

## Components

| Pattern | Source / classes | Behavior |
| --- | --- | --- |
| Statistics | `index.html`, `.stats`, `.stat`, `.compact-stats` | Dashes before data; tabular counts; compact summary values with full-number titles |
| Seat finder | `#seat-form`, `src/main.ts` | Native number input, Go button, inline described error, valid range 0–1999; selects and reveals the cell |
| Map | `HiveMap` in `src/map.ts` | Pointer/touch selection, desktop hover, visible ring, keyboard navigation, polite announcement |
| Seat panel | `#seat-panel`, `renderPanel()` | Empty prompt or selected details; success split, rank/share/last activity; previous/next boundaries disabled; close returns map focus when focus was inside |
| Busiest seats | `renderBusiest()`, `.busiest-row` | Top ten reported positive accepted counts; ties ordered by ID; whole row is a button; keyed nodes preserve focus on updates |
| Latest | `renderEvents()`, `.event`, `.seat-chip` | Eight newest valid seat events; page-built text; selecting a chip opens the seat |
| Buttons and focus | `button`, `.primary`, `:focus-visible` | At least 44px; one ember primary action; neutral secondary actions; 2px ember focus with forced-color fallback |
| Loading / failure | `src/poll.ts`, `#fetch-note` | Immediate lattice and dashes; 15s timeout; 30s request floor; pause hidden; retain last good data and show the specified failure note |

Arrow keys move one cell; Home/End reach row ends; Page Up/Down move ten rows; Enter/Space open; Escape closes. The visual map has an equivalent seat-number input and a text panel. Working glow is redrawn every 120ms through a 1.6s phase, only while visible and in view. Under reduced motion there is no pulse interval and no CSS dot animation. Changes in theme and DPR repaint the map; scrolling and hover do not repaint the static lattice.

## Do's and don'ts

- Reuse the semantic tokens, native controls, and `.card` treatment when extending this page.
- Keep actions above the content they affect and preserve the phone reading order.
- Use the five type roles rather than adding arbitrary sizes; keep counts tabular.
- Keep API values on the explicit parser allowlist, and render text through `textContent`.
- Keep zero/unknown values distinct. Missing numbers are dashes; missing seat entries stay unfilled; rank/share use reported accepted work.
- Keep this delivery to one page. A future section can reuse `.section-heading`, `.card`, and the 16px grid gap without adding a router or a new visual system.
- Do not add storage, wallet flows, analytics, remote assets, or animation beyond the specified status cues.

Design review used the pinned Better Interface guidance by Jakub Krehel (MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`). Documentation method: Paul Bakaus's Impeccable (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). The included license notices are retained in [`artifacts/design-guidance-LICENSE.txt`](artifacts/design-guidance-LICENSE.txt). Actual review evidence and limitations are in [`artifacts/validation.md`](artifacts/validation.md).
