# Development Plan

## Objective
Deliver a shareable vertical slice of Decoherence: a browser-playable double-slit experience with the observe mechanic and a stable CPU solver, ready for outside playtest feedback.

## Current State
- CPU leapfrog Schrödinger solver with absorbing mask, Gaussian seeding, and runtime tuning for `dt`, substeps, potential, absorb mask, and seed parameters.
- Canvas2D renderer with phase coloring, adaptive white point, regen overlay, and observe flash; overlays for coherence, win, and lose states; Observe action hook.
- Player movement tied to normalized density; coherence resource drains/regens based on local ∣Ψ∣²; detector win trigger; restart hooks.
- Missing pieces: no level data pipeline, minimal state management (single hard-coded level), no onboarding text or audio, no packaging/build tooling, and WebGL/worker paths are not started.

## Workstreams

### A. Core Simulation Stabilization — in progress
- Instrument probability norm and peak density monitoring; display warnings when drift exceeds tolerance.
- Clamp and persist `dt`/substep tuning; surface recommended stability ranges in UI and reset-to-defaults control.
- Profile frame time; add heuristic to reduce substeps or pause simulation when the budget is exceeded; prepare interface for a future worker offload.
- Revisit absorbing mask defaults and double-slit rebuild path to avoid visible pops or allocations every frame.

### B. Game Loop & UX — next
- Introduce an app state manager (boot → menu → gameplay → win/lose) that governs overlays, input capture, and restart/next flows.
- Move hard-coded geometry, detector placement, and coherence settings into a level config so restarts and future levels reuse the same loader.
- Add lightweight onboarding copy (controls, observe tooltip), observe cooldown HUD element, and pause/resume input.
- Ensure tuning changes persist across restarts and provide keyboard shortcuts for restart, pause, and toggling the tuning panel.

### C. Level & Mechanics Content — next
- Create a simple JSON (or JS) level descriptor and loader; author a single-slit tutorial followed by the existing double-slit scenario.
- Implement optional observer-effect trigger that swaps potentials or reseeds, ensuring coherence/player state stays coherent with the new simulation.
- Balance coherence drains, detector placement, and potential parameters per level; capture tuned defaults in data files.
- Log basic session metrics (time-to-detector, coherence remaining, observe uses) to aid balancing during playtests.

### D. Rendering & Performance — later
- Add on-screen fps/frame-time readout and resolution scaling control to keep 60 FPS on mid-range hardware.
- Start the WebGL2 ping-pong pipeline behind a feature flag, maintaining feature parity with the CPU renderer.
- Iterate on visualization: improved phase palette normalization, optional bloom/glow, and clearer regen/observe feedback without obscuring interference fringes.

### E. Tooling & Delivery — later
- Adopt Vite (or similar) for dev server and production builds; wire npm scripts and README instructions.
- Add lint/format scripts and lightweight tests for sampler math and coherence logic; set up CI placeholder if applicable.
- Document deployment path (GitHub Pages/itch.io), include troubleshooting tips, and capture screenshots/GIFs for the playtest drop.

## Milestones
- **M1 — Vertical Slice (1–2 weeks):** Workstreams A–C complete; double-slit + tutorial playable end-to-end with onboarding and stability safeguards.
- **M2 — Tech Upgrade (additional ~2 weeks):** WebGL option and performance instrumentation from Workstream D ready for broader hardware coverage.
- **M3 — Polish Pass (additional ~2 weeks):** Tooling/delivery tasks in Workstream E done plus visual/audio polish promoted from backlog.

## Validation Metrics
- Norm drift stays under 1% over 60 seconds at default settings, with HUD warning if exceeded.
- Playtesters complete the double-slit level with >60% success following the tutorial and use Observe at least once per run.
- Frame time remains under 16 ms on M1 Air / mid-range PC at default resolution; adaptive controls keep input responsive when slower hardware is detected.
