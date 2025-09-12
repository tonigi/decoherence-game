Target Stack

- Runtime: modern browsers (Chrome/Edge/Firefox/Safari).
- Rendering: WebGL2 for simulation + visualization; CPU fallback via Canvas2D.
- Language: ES Modules (optionally TypeScript later).
- Build/dev: Vite or Parcel (or simple static server for zero-setup).
- Workers: Web Worker for CPU simulation; OffscreenCanvas for GPU simulation (where supported).

Project Structure

- index.html: root page + minimal UI containers.
- src/main.js: app bootstrap, scene routing, RAF loop.
- src/sim/
  - grid.js: grid allocation, indexing, init (Gaussian packet), utilities.
  - potential.js: generators (single/double slit, well, barrier).
  - fdtd_cpu.js: CPU leapfrog FDTD (real/imag arrays).
  - fdtd_gl.js: WebGL2 ping‑pong shader pipeline. (later)
  - absorb.js: absorbing boundary mask/CAP.
- src/render/
  - renderer_gl.js: density visualization shader, color mapping. (later)
  - renderer_cpu.js: ImageData fallback.
  - palette.js: ∣Ψ∣² → color mapping utilities. (optional)
- src/game/
  - player.js: input, kinematics, sampling ∣Ψ∣², coherence drain.
  - coherence.js: resource model and UI binding.
  - detector.js: win trigger.
  - observer.js: which-slit trigger → potential swap + simulation reset. (later)
- src/levels/
  - schema.js: level JSON schema. (later)
  - levels/*.json: Single/Double Slit, Well, Tunneling. (later)
  - loader.js: load + (re)initialize sim/player from data. (later)
- public/: static assets (fonts/sfx later).

Physics Simulation (2D Schrödinger)

- Units: set ħ=1, m=1; choose dx, dt under stability constraints.
- State:
  - psiR, psiI: Float32Array length W*H (real and imaginary parts).
  - V: Float32Array potential map; optional CAP/absorbing mask.
- Discretization (five‑point Laplacian):
  ∇²f(i,j) ≈ (f[i+1]+f[i-1]+f[j+1]+f[j-1]-4f[i,j]) / dx².
- Time stepping (leapfrog, explicit):
  Split Ψ = a + i b.
  b^{n+1/2} = b^{n-1/2} + dt*(0.5*Lap(a^n) - V*a^n)
  a^{n+1}   = a^{n}     + dt*(-0.5*Lap(b^{n+1/2}) + V*b^{n+1/2})
- Absorbing boundaries: damping mask near edges applied every step.

GPU Path (WebGL2) – later phase

- Data: RG32F textures for Ψ, R32F for V; ping‑pong updates.
- Passes: imag half‑step, then real full‑step; fullscreen quad for render.
- Visualization: density = R²+G², mapped to color palette.

CPU Fallback (initial prototype)

- Implement leapfrog in JS; run 1–4 substeps per frame.
- Render density via Canvas2D ImageData.
- Use Worker in later iteration if main thread time exceeds budget.

Potentials and Levels

- Generators: single slit, double slit, potential well (V<0), barrier (tunneling).
- Level JSON (later): width, height, dx, dt, potential recipe, packet seed, detector, player, coherence, observer trigger.
- Loader builds V, seeds Ψ, positions player and detector.

Gameplay Systems

- Player movement: WASD/arrow; sample ∣Ψ∣² with bilinear interpolation.
- Speed: speed = baseSpeed * clamp(density*scale, min, max).
- Coherence: drain = baseDrain / (density + epsilon); decohere at 0.
- Detector: AABB; entering triggers win.
- Observer effect (later): swap potential, reset Ψ, keep player position.
- Observe (prototype gameplay): pressing O/Space samples a position from |Ψ|², teleports the player there, and collapses Ψ around that location; applies a coherence penalty and brief visual flash; cooldown prevents spamming.

UI/UX

- HUD: coherence bar, level name, pause indicator.
- Menus: main, pause, win/lose overlays; basic buttons.
- Accessibility: color palette toggle; motion reduction.

Performance

- Substeps per frame; resolution scaling; CPU/GPU fallback.
- Absorbing boundaries to reduce reflections; norm monitoring.

Validation

- Norm conservation tolerance check; visual sanity (diffraction/interference).
- Tuning tables per level for speed/drain; ensure viable bright‑path routes.

Milestones

- Phase 0 (Prototype, 1–2 weeks): CPU sim + Canvas render; Gaussian packet; double slit; player sampling; coherence; detector; basic HUD.
- Phase 1 (Core Loop, 2–3 weeks): WebGL2 sim + render; polished controller; game states; menus; single/double slit complete.
- Phase 2 (Content, 3–4 weeks): Well + tunneling; observer effect; JSON levels; level select.
- Phase 3 (Polish, 2–4 weeks): Visual shaders; sound hooks; tutorials; settings; difficulty curve.

Key Risks + Mitigations

- Stability/accuracy: start CPU leapfrog; add CAP; monitor norm; consider split‑operator if needed.
- Performance on low‑end: dynamic grid and substeps; CPU fallback; light visuals.
- WebGL float support: require WebGL2; fallback to CPU if unsupported.

Current Prototype (status)

- CPU Schrödinger solver with adjustable `dt` and substeps at runtime.
- Canvas2D renderer with adaptive tone mapping (percentile white point) and gamma.
- Phase coloring: hue encodes phase via atan2(Im, Re); value encodes intensity.
- Regen visibility: mint overlay plus neon boundary outline above regen threshold.
- Coherence HUD and win/lose overlays; double‑slit potential in use.
- Top‑right tuning panel to adjust simulation, renderer, player, coherence, potential, absorb mask, and reseed the packet.
- New gameplay: on-demand Observe collapse (O/Space) with penalty and cooldown.

Controls Reference (prototype)

- Simulation: `dt`, `substeps` (live via setters).
- Renderer: `gamma`, `percentile`, `regenOverlayAlphaMax`, `regenOverlayBrightMax`, `outlineIntensity`.
- Player: `baseSpeed`, `speedProfile.minFactor`, `speedProfile.maxFactor`.
- Coherence: `minDrain`, `maxDrain`, `regenThreshold`, `regenRate`.
- Potential (double slit): `barrierThickness`, `barrierV`, `slitHeight`, `slitSeparation`, `slitOffsetY`.
- Absorb: `margin`, `strength`.
- Seed: Gaussian `sigma`, `kx`, `ky`.
