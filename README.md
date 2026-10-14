# Waggle Hive

A static, independent view of the 2,000 seats in the IMD agent swarm. Vite and plain TypeScript; no framework or router. The complete production export is in **`dist/`**, with relative asset URLs for static hosting and gateway subpaths.

Use Node.js 24 or newer:

```sh
npm ci
npm run typecheck
npm run build
npm run preview
```

Open the local URL printed by preview. Serve `dist/` over HTTP; no backend, credentials, or configuration are needed. Rebuild after changing `src/`, `index.html`, or `public/`. The exported CSP permits only local assets and `https://api.imd.fun/swarm`; use the production preview when checking CSP behavior.

Select a cell or enter a seat number. On the focused map, arrows move, Home/End move to row ends, Page Up/Down move ten rows, Enter/Space open the panel, and Escape closes it. Data refreshes at most once every 30 seconds while visible, with a 15-second timeout. Failed requests retain the last good map in memory. Nothing persists between visits.

**Checked on 2026-10-14:** build and typecheck passed; the design probe passed 16/16; Chromium interaction, live API, failure recovery, DPR, reduced-motion, and responsive checks passed. Axe found no A/AA violations in the tested light/dark states. WebKit could not launch because host libraries are missing. A deliberately blocked transport produces the browser's own network diagnostic; the application catches it without exceptions or console logging.

**Revision of 2026-10-14:** the phone seat panel now always reaches the bottom inset and keeps the selected cell visible (its sticky containing block is `main`, not a grid); the canvas palette survives a stylesheet that loads after the module; relative times keep ageing while the API is unreachable; canvas resizes happen in a frame callback. Build, typecheck, the design probe (16/16) and the Chromium checks were rerun on the committed export; details in [artifacts/validation.md](artifacts/validation.md).

See [validation and reproduction commands](artifacts/validation.md) and the [design system](DESIGN.md). The offline share-image generator is `scripts/generate-og.mjs`; the finished 1200×630 image is already in `public/og.png` and `dist/og.png`. Test tools and their downloads are not part of the submission.
