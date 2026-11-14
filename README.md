# StageDrill — Concert Ticket & Seat Selection Practice Simulator

An independent, browser-based seat selection practice simulator built with **Astro + TypeScript + React + Tailwind CSS + SVG**.

## Disclaimer & Scope
- **Independent educational tool:** Not affiliated with Ticketmaster, Live Nation, or any ticketing platform.
- **Fictional venue & virtual budgets:** Uses *Starlight Civic Arena* (demo layout, 5 sections, 120 seats) with virtual prices only.
- **No live integrations:** No ticketing accounts, real seat holds, payment collection, or server-side tracking.
- **Practice score only:** Scores (`0–100`) reflect rule-based simulation execution (count, adjacency, aisle rules, budget, zone pivot, speed, precision) and do not predict or improve real ticket queue placement.

## Practice Modes
1. **Quick Pick:** Spot 1–4 adjacent seats matching budget and target section without crossing the center aisle (`S4` | `AISLE` | `S5`).
2. **Live Scramble:** Mid-round demand waves lock seats dynamically (triggering realistic conflicts if you picked a contended seat) while guaranteeing a solvable backup block.
3. **Full Drill:** Brief simulated queue transition (with an instant **Skip Waiting Room →** option) into timed live selection and debrief.

## Local Development & Verification

```bash
npm install
npm run dev        # Start local Astro dev server
npm run typecheck  # Astro & TypeScript checks
npm test           # Run Vitest suite (adjacency, aisle, PRNG, solvability, timer, storage fallback)
npm run build      # Build static site to dist/
npm run preview    # Preview production static build locally
```

## Architecture
- `src/lib/prng.ts` — Deterministic xmur3 + Mulberry32 PRNG and sanitized `?mode=&difficulty=&seed=` URL state.
- `src/lib/venue.ts` — Fictional 2D arena geometry (`DEMO_VENUE`), explicit seat `adjacencyGraph`, and `areSeatsAdjacent`.
- `src/lib/generator.ts` — Deterministic mission & scramble-wave generator with `verifyRoundSolvability`.
- `src/lib/rules.ts` — Seat toggle rules and live scramble conflict resolution.
- `src/lib/scoring.ts` — Transparent 100-point Practice Score and diagnostic feedback messages.
- `src/lib/timer.ts` — `performance.now()` monotonic clock, tab-visibility pause state, and `VisibilityStateEntry` foreground tracking.
- `src/lib/storage.ts` — `localStorage` persistence (`stagedrill_settings_v1`, `stagedrill_history_v1`, `stagedrill_active_round_v1`) with in-memory fallback.
- `src/components/SeatMapSvg.tsx` & `src/components/SimulatorApp.tsx` — Zoomable SVG `role="grid"` seat map with roving-tabindex spatial arrow navigation and responsive mobile dock.
