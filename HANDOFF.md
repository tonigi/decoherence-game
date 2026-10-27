# Handoff: Born Rule

State of the `born-rule` branch for whoever picks this up next. `README.md` is the
player- and format-level reference. `docs/mechanics-review.md` holds the design review
and a log of every round of work, with the numbers behind each decision. This file is
the orientation: what exists, how it fits together, which invariants must hold, what
is open, and how to work on it without breaking anything.

## 1. Where things stand

* 18 levels in 6 chapters: free propagation (1-1…1-4), tunnelling (2-1, 2-2),
  interference (3-1, 3-2), bound states and lenses (4-1…4-3), measurement (5-1, 5-2),
  and polarization (6-1…6-5, spinor ψ).
* `npm test`: 45 tests, all passing (~1 min). `npm run verify`: every level passes. The
  reference solution reaches 2 stars, and naive play stays below 1 star (3-1 is
  exempt, see §5).
* Pure ES modules with no build step and no dependencies. `npm start` serves the game
  on `:8000`. Chromium and Playwright are preinstalled in the cloud container if you want
  to drive the UI headlessly (see §6).

| Level | Lesson | Reference | Naive |
|---|---|---|---|
| 1-1 Rendezvous | measured at t = 10: σ₀ = √(t/2) | 44 % | 7 % |
| 1-2 Between the Mines | aiming, timing | 23 % | 8 % |
| 1-3 Nudge | kicks and tilt | 39 % | 0 % |
| 1-4 Sharp Momentum | momentum measurement, σₓσₖ ≥ ½ against a finite world | 82 % | 12 % |
| 2-1 Thin Wall | tunnelling vs energy | 29 % | 12 % |
| 2-2 Mirror | placed barrier | 54 % | 1 % |
| 3-1 Two Slits | fringes (introductory, exempt from the naive check) | 13 % | n/a |
| 3-2 Mach–Zehnder | a phase plate swaps the ports | 43 % | 11 % |
| 4-1 Coherent State | only σ₀ = 1/√(2ω) does not breathe | 65 % | 31 % |
| 4-2 Fourier Lens | x ↔ k after T/4, finite aperture | 70 % | 21 % |
| 4-3 Delta-Kick Cooling | a timed harmonic pulse removes the x–k correlation | 80 % | 7 % |
| 5-1 Which Way? | a which-path detector lights the dark port | 24 % | 11 % |
| 5-2 Hold Still | Zeno freezing with a pulsed detector | 53 % | 16 % |
| 6-1 Three Polarizers | crossed polarizers; inserted ones let light through | 23 % | 0 % |
| 6-2 Watched Pot | polarization Zeno: N polarizers in a rotator, equal spacing | 26 % | 1 % |
| 6-3 Half-Wave | a retarder rotates losslessly; thickness sets the retardance | 53 % | 0 % |
| 6-4 Stern–Gerlach | the magnet splits along its axis; align it, aim with the gradient | 27 % | 4 % |
| 6-5 Bomb Tester | Kwiat's interaction-free test: one bomb station per rotator cycle | 15 % | 1 % |

## 2. Architecture (src/, ~2000 lines)

| File | Role |
|---|---|
| `fft.js` | radix-2 complex FFT. `pass()` is the transposed fast path used by the propagator; `forward`/`inverse` give the normal layout. |
| `sim.js` | 2D TDSE solver, ħ = m = 1, Strang split-step (V/2 → T → V/2). Static V, gates (V and/or absorption W, ramped), tilt, boundary absorber W, element absorber Wel with exact `caught` bookkeeping, harmonic contours for display. Observables: `norm`, `mass`, `mass2`, `kMass` (k-space), `kDensity`, `stats` (Δx, Δkₓ, ⟨E⟩), `kLeak`. `step(n, others)` steps extra states in lock-step; `withState(st, fn)` runs any method on another state. Spinor mode (`spinor: true`) adds `re2/im2`; every per-state loop goes through `comps()`, `snapshot()`/`load()` copy states, and optics are a sparse per-cell 2×2 exponential (`spinExp`, exact for complex h) beside the scalar half-steps. `stokes()`, `polMass()` read the polarization. |
| `optics.js` | polarization optics as spin Hamiltonian terms h₀ + h·σ (polarizer: absorbing or reflecting projector; rotator ω σ_y; retarder (δ/2) n(θ)·σ; Stern–Gerlach `zeeman` g·v·n(θ)·σ, where Session scales the mask by the transverse coordinate v); `bomb: true` routes an optic's absorption into `caught`; `jones()` for launch polarizations. |
| `shapes.js` | rasterisation with tanh edges of fixed physical width `SOFTNESS = 0.45` at every N (this keeps the 64² ghost consistent with the 128² game). Rects take `angle`; also `disc`, `wall` with slits, `harmonic`. `rasterKMask` builds momentum-space masks on the fft-shifted grid (dk = 2π/L, the same for every N). |
| `session.js` | DOM-free game core: one playthrough = (level, setup, seed, event log). Setup sanitising, items, detectors (Kraus `M_yes = √s·m`, `M_no = √(1 − s m²)`), the observation (Born sample in x or k space; P(hit) = P_T exactly), scoring (`scoreWith`), `replay`. |
| `ledger.js` | skill score for runs with detector firings: replays the open-loop inputs, splits every branch at each firing, compresses beyond 16 branches to the leading eigenvectors of ρ (deterministic; the error is bounded by the reported `dropped`). Returns the branch states plus its 64² `Sim` for the Branches panel. |
| `ghost.js` | low-res (64²) forward preview of P_T(t) for the current setup. |
| `render.js` | canvas: domain colouring / \|ψ\|² / zoomed momentum view, potential tint, absorber tint, harmonic contours, overlays (rotated shapes, k-space regions), setup handles. |
| `audio.js` | Web Audio sonification: `analyse(sim)` (band weights, mean/sd of x, RMS k; pure, tested) drives a pentatonic pad, HRTF-placed by mean x, crossfading to a surround bed as sd(x) grows; Born-rule-sampled bells; event chimes; observation fades to silence plus one faint tone at the found position. Uses `Math.random` only, outside the session. |
| `main.js` | UI: level picker, sliders, inventory, playfield handles, input, run loop, result banner, Branches panel, HUD readouts. |

`tools/verify.js` checks every level (and `--replay file.json` re-verifies a saved run).
`tools/solve.js` is a derivative-free optimiser over the setup parameters, used to find
references and calibrate stars.

## 3. Invariants (do not break these)

1. **Determinism.** Everything a run does is in `(level, setup, seed, events)`. Events
   happen at integer step boundaries, and all dice come from the session's
   `mulberry32(seed)`. `replay()` must reproduce `pT` bit-for-bit (tested). Don't call
   `Math.random()` in the core, and don't add extra `rng()` draws before existing ones
   without accepting that old replays will change.
2. **Probability bookkeeping.** `norm + caught + boundary loss = 1` at all times (tested
   exactly). Detector outcomes condition `caught` via `conditionCaught`. Gate absorption
   (shutters) is counted as lost, not as `caught`.
3. **Born rule.** The observation samples |ψ|² (or |φ(k)|²). Hit/mine use a second
   uniform against the smooth masks, so P(hit) = P_T and P(mine) = P_M exactly.
4. **Scoring.** Stars come from P_T at the observation. After any detector firing they
   come from the ledger's branch average instead, which removes post-selection luck (a
   test reproduces the old exploit). Expectation mode is fixed per run and keeps its
   own star table (`id@expect` in localStorage).
5. **Spinor parity.** Scalar levels must not pay for spinor mode, and anything that
   touches a state (new observables, operations, ledger copies) must go through
   `comps()` / `snapshot()` so the second component is never silently dropped. The
   spinor change left every scalar level's verify output byte-identical.
6. **Resolution independence.** Physics must agree between 64² (ghost, solver, ledger)
   and 128² (game). Keep edges at `SOFTNESS` and keep launch k below 0.6·k_max of the
   64² grid (≈ 3.0). A test enforces the latter, and the ghost aliases above it.
7. **Level contract.** `verify.js` must pass: reference ≥ 2 stars, `naive` < 1 star
   (without `observeAt` the naive run is observed at its best moment).
   `"naive": false` needs a `naiveSkip` reason.

## 4. Level design workflow

1. Prototype the physics headlessly in the scratchpad with `Session` and `defaultSetup`;
   scan the player's parameters and look for an **interior optimum** and a **≥ 2×
   contrast** between insight and naive play. Most rejected ideas failed one of
   these; see the review log.
2. Check 64² against 128² (the ghost and the ledger run at 64²).
3. Write the JSON. Use `minObserveTime = tmax` for a fixed observation time (this kills
   "max the speed slider" optima). Use `observe: "momentum"` plus `kView` for k-space
   targets. Add `reference` and `naive`, and use `tools/solve.js` to refine the
   reference and set the stars.
4. `npm run verify`, `npm test`, then play it in the browser.

## 5. Known issues and limits (with the numbers)

* **The Mach–Zehnder dark port leaks 8–10 %** (visibility ≈ 0.6–0.7). The splitter (a thin
  45° barrier) is strongly energy-dependent: T goes 0.39 → 0.59 for k 2.7 → 3.3, so
  reflection selects slower, more oblique components and the two paths overlap only about
  70 % in mode shape, though their phase is right. dt convergence is clean. This caps
  3-2 and 5-1 at about a 4:1 contrast and **blocks the bomb tester**: blocking an arm only
  moves the dark port 0.10 → 0.13. The fix needs a thinner, delta-like splitter, which
  needs sharper edges than `SOFTNESS` allows, i.e. a finer grid (256², WebGPU), or a larger
  k with the ghost at 128².
* **3-1 is exempt from the naive check.** In 2D the slit diffraction spreads P_T to a few
  percent. Also, the fringe spacing at time t is 2πt/d, independent of k, so "tune the
  wavelength" barely moves P_T. Four redesigns were tried (logged).
* **Slider-limit warnings** remain on 1-2, 2-1, 2-2, 3-1 and 3-2 (the optimum is "max
  that slider"). This is cosmetic, but 1-2 and 2-1 would benefit from the fixed-time
  trick used in 1-1.
* **After an observation the meters show the collapsed state** (pre-existing behaviour;
  it can look surprising, e.g. P_T 52 % after a miss).
* **Weak detectors have no level yet.** With a single P_T objective, Zeno's score is
  monotone in the strength s. An information/disturbance trade-off needs a two-part
  objective (see the eraser below).
* **Dropped ideas, so nobody repeats them blindly:** the "Shutter" (a reflecting shutter
  pumps energy and traps; an absorbing chopper is clean but gives only about 3 % vs 1.7 %),
  the "Energy filter" (barrier filtering does not change the absolute high-k
  probability), and box revivals (T_rev = 4L²/π is too long at useful sizes).
* **Reflecting splitters inside a rotating medium form cavities.** A polarizing beam
  splitter overlapping a rotator reflects V backwards, which keeps rotating and leaks
  H forward between neighbouring splitters (6-5 prototype: 0.85 against the ideal
  0.61). Keep reflecting optics outside rotators, as in a real apparatus, or use
  absorbing / `bomb` optics. Likewise any polarizer *inside* a rotator watches the
  rotation continuously and beats the discrete Zeno law; 6-5 uses placement zones to
  keep its stations in the gaps.
* **Performance.** CPU JS at 128² is about 1.4 ms/step. Ledger scoring of a 48-pulse
  Zeno run takes about 2.5 s (async, shows a "Scoring…" banner); the Jacobi
  eigen-solve on the 32×32 Gram embedding dominates.

## 6. Working practices that paid off

* **Validate physics numerically before committing a mechanic.** Every scoring or
  physics change in this branch was checked against an exact or analytic reference
  (martingale, exact branch tree, Monte Carlo with ≥ 150 seeds, the analytic coherent-
  state width, Parseval, Heisenberg). Two real bugs were found this way (resampling
  variance, and a cut-search bug that dropped weight).
* **Browser checks.** Serve with `python3 -m http.server 8123` and drive it with
  Playwright (`require('playwright')`, `chromium.launch()`). Wait on the `#clock` text
  for timing, read `#banner`, `#ledgerRows` and the slider values, take screenshots, and
  collect `pageerror` and `console.error`. The scripts used are not committed; they
  are short and easy to rewrite.
* Commit messages describe the physics reason for each change; keep doing that.

## 7. Roadmap (in suggested order)

1. **More spinor levels on the new optics.** The solver, ledger and UI are done
   (chapter 6, including Stern–Gerlach and the bomb tester). Cheap next steps:
   (a) **sequential Stern–Gerlach** (z, then x, then z again gives 50/50: measurement
   disturbs), with a blocker on one exit of the first magnet; (b) **the quantum
   eraser**: orthogonal polarizers on two slits kill the fringes, a ±45° analyzer target
   restores them in the post-selected half. Erasure never raises P_T above the
   incoherent sum, so it needs the two-part objective (score fringes *and* a which-way
   readout, or P_T − P_M) that weak detectors need too; (c) a **two-world bomb tester**
   (with and without the bomb, scored together) needs the same two-part objective;
   6-5 shows the bomb-present world only; (d) gated optics (already supported) as real-time player tools, e.g.
   a polarizer you switch in at the right moment, or Zeno with a polarizer as the
   pulsed "detector".
2. **Finer grid / WebGPU port.** The split-step maps directly onto compute shaders. 256²
   would allow a delta-like splitter (unblocking the bomb tester and cleaning up 3-2 and
   5-1) and sharper levels. Keep the CPU path as the reference for replay verification.
3. **Fixed-time redesigns of 1-2 and 2-1** to remove the slider-limit optima.
4. **Bomb tester (3-5)** once the dark port is clean: the absorbing-element mechanic
   (`absorb: W`, "boom" outcome) is already in and tested.
5. **An adjoint solver** for hints and difficulty ratings (the dynamics are linear and
   differentiable), replacing the random-restart `solve.js`.
