# Handoff: Born Rule

State of the `born-rule` branch for whoever picks this up next. `README.md` is the
player- and format-level reference. `docs/mechanics-review.md` holds the design review
and a log of every round of work, with the numbers behind each decision. This file is
the orientation: what exists, how it fits together, which invariants must hold, what
is open, and how to work on it without breaking anything.

## 1. Where things stand

* 38 levels in 10 chapters: the guided tutorial (0-1…0-3), free propagation (1-1…1-4), tunnelling (2-1, 2-2),
  interference (3-1, 3-2), bound states and lenses (4-1…4-4), measurement (5-1, 5-2),
  polarization (6-1…6-8, spinor ψ), gratings and lattices (7-1…7-3), two particles (8-1) and
  rings and flux (9-1…9-9, periodic boundaries).
* Every level that re-enacts a textbook experiment names it in `experiment`, shown to the
  player under the level title, on the chapter-map card and in the physics drawer.
* `npm test`: 68 tests, all passing (~1.5 min). `npm run verify`: every level passes. The
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
| 4-4 Bang-Bang | trap transport: midpoint trap for half a period (state target) | 96 % | 0 % |
| 5-1 Which Way? | a which-path detector lights the dark port | 24 % | 11 % |
| 5-2 Hold Still | Zeno freezing with a pulsed detector | 53 % | 16 % |
| 6-1 Three Polarizers | crossed polarizers; inserted ones let light through | 23 % | 0 % |
| 6-2 Watched Pot | polarization Zeno: N polarizers in a rotator, equal spacing | 26 % | 1 % |
| 6-3 Half-Wave | a retarder rotates losslessly; thickness sets the retardance | 53 % | 0 % |
| 6-4 Stern–Gerlach | the magnet splits along its axis; align it, aim with the gradient | 27 % | 4 % |
| 6-5 Bomb Tester | Kwiat's interaction-free test: one bomb station per rotator cycle | 15 % | 1 % |
| 6-6 Humpty Dumpty | full-loop Stern–Gerlach: gradient pulses +τ, −2τ, +τ restore the spin | 55 % | 0 % |
| 6-7 Ask Again | sequential Stern–Gerlach: a 45° magnet between two 0° ones restores 50/50, if its gradient separates the beams | 30 % | 0 % |
| 6-8 Two Worlds | bomb tester scored with and without the bomb (`worlds`): no looks ≤ ¼; Zeno looks with plates at 17° | 42 % | 19 % (best no-look) |
| 7-1 Light Grating | Kapitza–Dirac: a flash fills the orders with J_n(Vτ/2)² | 65 % | 1 % |
| 7-2 Self-Image | Talbot effect: fire a phase-grating flash half a Talbot time early | 42 % | 21 % |
| 7-3 Bragg Mirror | weak ridges reflect where k_in = π/a, above the ridge height | 59 % | 3 % |
| 8-1 Bunching | Hong–Ou–Mandel: ψ(x₁, x₂) of two bosons; T = ½ makes them leave together | 93 % | 47 % |
| 9-1 Loop Mirror | Sagnac ring + Aharonov–Bohm: Φ = Φ₀/4 turns the loop mirror into a window | 63 % | 3 % |
| 9-2 Push Less | Bloch oscillations on a ring: let go of the push near T_B/4 | 61 % | 8 % (holding) |
| 9-3 Half Steps | flux shifts the comb k = (2πn + θ)/L; Φ₀/2 puts a tooth halfway | 62 % | 0 % |
| 9-4 Pairs | two particles on a ring: total momentum shifts by 2θ/L; Φ₀/4 (h/2e) | 42 % | 0 % (Φ₀/2) |
| 9-5 Leak | Sagnac loop mirror + a drain switched on for one half: interaction-free | 20 % | 6 % |
| 9-6 Revival | torus L = 10: revival at L²/π, displaced θL/π by a flux | 77 % | 0 % |
| 9-7 Chopper | time-of-flight velocity selection with a drain; post-selected score | 52 % | 19 % |
| 9-8 Bound Pair | a spring-bound pair in the loop mirror: window at Φ₀/8 (h/2e) | 85 % | 16 % (Φ₀/4) |
| 9-9 Pauli Ring | two fermions in the cold square need Φ₀/2 (parity effect) | 100 % | 0 % |

## 2. Architecture (src/, ~3100 lines)

| File | Role |
|---|---|
| `fft.js` | radix-2 complex FFT. `pass()` is the transposed fast path used by the propagator; `forward`/`inverse` give the normal layout. |
| `sim.js` | 2D TDSE solver, ħ = m = 1, Strang split-step (V/2 → T → V/2). Static V, gates (V and/or absorption W, ramped), tilt, boundary absorber W, element absorber Wel with exact `caught` bookkeeping, harmonic contours for display. Observables: `norm`, `mass`, `mass2`, `kMass` (k-space), `kDensity`, `stats` (Δx, Δkₓ, ⟨E⟩), `kLeak`, `modeMass` (overlap with a Gaussian mode). Per-axis `periodic` boundaries and the `gauge` (twist / force on a ring, §2.1); `exchange(±1)` (anti)symmetrises ψ(x₁, x₂). `step(n, others)` steps extra states in lock-step; `withState(st, fn)` runs any method on another state. Spinor mode (`spinor: true`) adds `re2/im2`; every per-state loop goes through `comps()`, `snapshot()`/`load()` copy states, and optics are a sparse per-cell 2×2 exponential (`spinExp`, exact for complex h) beside the scalar half-steps. `stokes()`, `polMass()` read the polarization. |
| `optics.js` | polarization optics as spin Hamiltonian terms h₀ + h·σ (polarizer: absorbing or reflecting projector; rotator ω σ_y; retarder (δ/2) n(θ)·σ; Stern–Gerlach `zeeman` g·v·n(θ)·σ, where Session scales the mask by the transverse coordinate v); `bomb: true` routes an optic's absorption into `caught`; `jones()` for launch polarizations. |
| `shapes.js` | rasterisation with tanh edges of fixed physical width `SOFTNESS = 0.45` at every N (this keeps the 64² ghost consistent with the 128² game). Rects take `angle`; also `disc`, `wall` with slits, `harmonic`, and `lattice` (V sin²(πu/period), optionally in a soft rect window; also a placeable inventory item). `rasterKMask` builds momentum-space masks on the fft-shifted grid (dk = 2π/L, the same for every N). |
| `session.js` | DOM-free game core: one playthrough = (level, setup, seed, event log). Setup sanitising, items, detectors (Kraus `M_yes = √s·m`, `M_no = √(1 − s m²)`), drains, the observation (Born sample in x or k space, or the projector onto a state target; P(hit) = P_T exactly), post-selection (`herald`), scoring (`scoreWith`), `replay`, and `worlds` (sibling sessions in lock-step, scored by the product). |
| `ledger.js` | skill score for runs with detector firings: replays the open-loop inputs, splits every branch at each firing, compresses beyond 16 branches to the leading eigenvectors of ρ (deterministic; the error is bounded by the reported `dropped`). Returns the branch states plus its 64² `Sim` for the Branches panel. |
| `ghost.js` | low-res (64²) forward preview of P_T(t) for the current setup. |
| `render.js` | canvas: domain colouring / \|ψ\|² / zoomed momentum view (kinetic momentum, crisp k cells on ring levels), potential tint, absorber tint or portal edges (with the flux), harmonic and pair contours, the exchange diagonal on two-particle levels, overlays (rotated shapes, k-space regions), setup handles. |
| `audio.js` | Web Audio sonification: `analyse(sim)` (band weights, mean/sd of x, RMS k; pure, tested) drives a pentatonic pad, HRTF-placed by mean x, crossfading to a surround bed as sd(x) grows; Born-rule-sampled bells; event chimes; observation fades to silence plus one faint tone at the found position. Uses `Math.random` only, outside the session. |
| `main.js` | UI: level picker, sliders, inventory, playfield handles, input, run loop, result banner, Branches panel, HUD readouts. |

### 2.1 Mechanics added for the textbook and ring levels (4-4, 6-6, chapters 7–9)

* **State targets** (`{shape: "state", x, y, sigma}`): the observation is the projector
  onto a coherent state, P_T = Σ_c |⟨φ|ψ_c⟩|² (`Sim.gaussianMode`, `modeMass`,
  `projectMode`). It must be the only target, with no mines.
* **Pulse gates** (`gate.pulse` = steps): a key press closes the gate for that long and it
  reopens by itself. This happens inside `Sim._refresh`, so the ledger sees the same
  pulses; a pulse gate created closed fires at t = 0.
* **Launch and field**: `launch.sigmaT` (width across the motion); `field` (a constant
  force added to the player's tilt).
* **Elements**: `lattice` (V sin²(πu/period), optional soft window; also an inventory
  item) and `pair` (a harmonic bond ω²u²/2 in u = (x₁ − x₂)/√2, wrapped round the box,
  flat beyond R; drawn as contours, so keep ½ω²R² off a multiple of 2 or the flat
  outside becomes one big contour).
* **Two particles** (`particles: "bosons" | "fermions" | "distinguishable"`): the grid is
  ψ(x₁, x₂), (anti)symmetrised by `Sim.exchange`.
* **Boundaries** (`boundary`: `"absorb"` default, `"periodic"`, or `{x, y}`): the FFT box
  is a torus, and a periodic axis drops the absorber (`Sim.periodic`, `absorbX/absorbY`).
  `grid.L` is per level (9-6 uses L = 10).
* **Gauge** (`Sim.gauge`, `_buildKinetic`): the kinetic propagator uses (k + g)². A twist
  (`setTwist`, from `launch.flux` in flux quanta, θ = 2πΦ/Φ₀, on `fluxAxis` x, y or xy)
  sets g = θ/L; a force (field or tilt) along a periodic axis drives g += F dt, with the
  step using its midpoint, instead of a sawtooth potential. The launch subtracts g, so
  the physical packet does not depend on the flux. Everything in momentum is kinetic,
  k + g: the HUD, the momentum view (drawn shifted by g to a fraction of a cell), k-space
  regions (`Session._kRegions` rebuilds them when g moves) and the Born sample. k regions
  may set `edge` (softness; 0.005 resolves single teeth of the comb).
* **Drains** (`drains: [{side, key}]`): a gate carrying an absorbing strip on one side, a
  smooth bump 2 sin²(πd/A) that vanishes at both ends; its loss counts as lost.
* **Post-selection** (`postselect: {min}`, `Session.herald()`): P_T and P_M are divided by
  max(norm, min) and the observation samples among the survivors. Refused together with
  detectors or bombs (the ledger and `caught` are not conditioned).
* **Experiment names**: `experiment` is shown under the title, on the map card and in
  the drawer.
* **Worlds** (the two-part objective; `worlds: [{name, elements?, targets?, mines?, field?,
  drains?, items?: {id: patch | null}}, …]`, `worldLevel()`): one setup and one input log
  run in several variants of the level, in lock-step. The Session is world 0 and keeps the
  others in `worlds` (sibling Sessions; `_others()` forwards steps, kicks, tilt and gates).
  An item patched to `null` does not exist in that world. `pT()` is the product of the
  worlds' `ownPT()`; the observation samples each world with its own dice (seed derived
  from the run's), and the run is a hit only if every world hits, so P(hit) = Π P_T
  exactly. The HUD's ring shows the product, the readout each world's P_T, mines and
  losses the shown world's; a toggle under the view switch picks the shown world.
  Refused together with detectors (the ledger follows one world). A product, not a min or
  a mean: it is the only combination that is itself a Born probability.

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
3. **Born rule.** The observation samples |ψ|² (or |φ(k)|², in kinetic momentum). Hit/mine
   use a second uniform against the smooth masks, so P(hit) = P_T and P(mine) = P_M
   exactly. A state target is a projective measurement with P(hit) = |⟨φ|ψ⟩|²; on a
   post-selected level the sample is drawn among the survivors, so P(hit) = P_T/herald.
   On a level with `worlds` each world is observed on its own and P(hit) = Π_w P_T,w.
   All four are Monte Carlo tested.
4. **Scoring.** Stars come from P_T at the observation. After any detector firing they
   come from the ledger's branch average instead, which removes post-selection luck (a
   test reproduces the old exploit). On a `postselect` level the score is the conditional
   P_T; on a `worlds` level it is the product of the worlds' P_T. Expectation mode is fixed per run and keeps its own star table (`id@expect` in
   localStorage).
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
8. **Seamless periodic axes.** Anything acting along a periodic axis must be continuous
   across the seam: kicks are rounded to whole quanta 2π/L, forces go through the gauge,
   drains are a bump that vanishes at the seam, the launch is summed over periodic images,
   and full-length lattices fit a whole number of periods (tested). A jump at the seam
   reflects and shows up as high k ("momentum budget" warning).

## 4. Level design workflow

1. Prototype the physics headlessly in the scratchpad with `Session` and `defaultSetup`;
   scan the player's parameters and look for an **interior optimum** and a **≥ 2×
   contrast** between insight and naive play. Most rejected ideas failed one of
   these; see the review log.
2. Check 64² against 128² (the ghost and the ledger run at 64²).
3. Write the JSON. Use `minObserveTime = tmax` for a fixed observation time (this kills
   "max the speed slider" optima, and "observe while the packet passes" optima on rings).
   Use `observe: "momentum"` plus `kView` for k-space targets. When the objective is a
   state rather than a place, use a state target (it also kills timing exploits: the
   fidelity with a stationary state is conserved). When the mechanic removes probability,
   absolute P_T cannot reward it: use `postselect`. Give each level its `experiment`. Add `reference` and `naive`, and use `tools/solve.js` to refine the
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
  monotone in the strength s. The two-part objective now exists (`worlds`), but worlds
  refuse detectors, because the ledger follows one world. A fringe dial either marks the
  path in the polarization (a rotator in one arm, read out by an analyzer in a second
  world), or the ledger learns to branch every world at once.
* **Textbook ideas tried and parked (numbers in the scratch runs behind 4-4…8-1):**
  *Spatial Talbot carpet* behind a slit grating: a short pulse only shows the temporal
  carpet as it moves, and the target slice catches 1–5 %; the pulsed phase grating
  (7-2) replaced it. *Spatial Stern–Gerlach loop* (+g, −2g, +g magnets in a row): the
  magnets' entrance and exit edges give each beam a v-dependent longitudinal kick of
  opposite sign for H and V (g·d ≈ 1.5 against E ≈ 3), which tilts their wavefronts
  apart; the loop recombined only 1–10 %. The time-domain version (6-6) works. *Bloch
  oscillations* in an open box (lattice item + `field`; solved on a ring instead, 9-2): in L = 40 there is no window where a shallow
  lattice neither leaks by Zener tunnelling (F = 0.2–0.3, V = 0.6: 20–50 % lost) nor
  traps classically (V > F·a; F = 0.1, V = 1: periods 3.5–5 hold 55–63 % just as wells
  would). The oscillation itself is clean (a = 2: P_home 0.66 → 0.02 at t = 16 → 0.48 at
  T_B = 31).
* **Dropped ideas, so nobody repeats them blindly:** the "Shutter" (a reflecting shutter
  pumps energy and traps; an absorbing chopper is clean but gives only about 3 % vs 1.7 %),
  the "Energy filter" (barrier filtering does not change the absolute high-k
  probability). Box revivals with L = 40 (T_rev = 4L²/π is too long) became 9-6 on a
  small torus (L = 10, T = L²/π = 31.8).
* **Reflecting splitters inside a rotating medium form cavities.** A polarizing beam
  splitter overlapping a rotator reflects V backwards, which keeps rotating and leaks
  H forward between neighbouring splitters (6-5 prototype: 0.85 against the ideal
  0.61). Keep reflecting optics outside rotators, as in a real apparatus, or use
  absorbing / `bomb` optics. Likewise any polarizer *inside* a rotator watches the
  rotation continuously and beats the discrete Zeno law; 6-5 uses placement zones to
  keep its stations in the gaps.
* **Ghost vs game on 9-5.** The drain level's 64² preview reads a few percent higher than
  the 128² game (no drain: 11 % vs 7 %), because the thin wall's transmission differs
  between the grids. Scores come from 128².
* **Gate hotkey labels** are drawn at the top-left of the playfield and overlap the clock
  badge on levels with gates (seen on 4-3, 4-4). Cosmetic.
* **Pair levels need a stiff bond.** With ω = 1 the walls of 9-8 tear the pair apart
  (about 10 % ends more than 3 apart after one hit); ω = 2 keeps it bound but its width (0.5) is under-resolved
  at 64² (dx = 0.625). The ghost still agrees within 3 %.
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
* **Every push bumps the version, at least the minor number.** `npm version minor
  --no-git-tag-version` (or `major`), commit `package.json` with the change, then push.
  `package.json` is the version of record. The deploy workflow stamps `version.json` with it plus
  the short git hash, and the title screen shows `vX.Y.Z · <hash>` (locally `vX.Y.Z · dev`).
  Before 1.0, `0.MINOR.0` is the normal bump; use major only for a deliberate 1.0.
* Commit messages describe the physics reason for each change; keep doing that.

## 7. Roadmap (in suggested order)

1. **More spinor levels on the new optics.** The solver, ledger and UI are done
   (chapter 6, including Stern–Gerlach, sequential Stern–Gerlach (6-7), the bomb tester
   and the two-world bomb tester (6-8, on the `worlds` two-part objective)). Cheap next
   steps: (b) **the quantum eraser**: orthogonal polarizers on two slits kill the
   fringes, a ±45° analyzer target restores them in the post-selected half. Erasure
   never raises P_T above the incoherent sum, so score it in two worlds, one per analyzer
   (+45° and −45°, each with its own fringe targets, both post-selected): only an eraser
   gets fringes in both; (d) gated optics (already supported) as real-time player tools, e.g.
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
6. **More textbook levels** (the full pending list is §8). Everything in §8.1 is built.

## 8. Pending level ideas (all of them, one place)

Each still has to pass the §4 contract (interior optimum, ≥ 2× over naive play,
64² ≈ 128²). "Engine" says what is missing; "none" means the existing mechanics suffice.

| Idea | Lesson | Engine | Notes |
|---|---|---|---|
| Quantum eraser (5-6) | orthogonal polarizers on two slits kill fringes; a ±45° analyzer restores them post-selected | none (`worlds` + `postselect`) | §7.1b; erasure never beats the incoherent sum, so one world per analyzer |
| Fringe dial (5-5) | weak which-way marker: V² + D² ≤ 1 | `worlds` with a polarization marker, or a ledger over worlds | worlds refuse detectors (§5) |
| Bomb tester in Mach–Zehnder (3-5) | Elitzur–Vaidman with a real interferometer | 256² for a delta-like splitter | §5 dark-port leak |
| Gated optics as tools | switch a polarizer in at the right moment; Zeno with a polarizer as the pulse | none | §7.1d |
| Double barrier (2-4) | resonant tunnelling: two walls transmit more than one | none | needs σ_k below the resonance width |
| Reflected above the wall (2-5) | a step or well reflects even with E > V | none | |
| Ramsauer–Townsend | an attractive well is transparent when 2a·k_in = nπ | none | contrast T = 1 vs ≈ 0.85 is weak; needs a deep well and low k, or a reflected-wave target |
| Gamow decay | exponential leakage from a quasi-bound state; rate ∝ exp(−2∫κ) | none | pick the wall so half escapes by a fixed time; pairs with 5-4 (short-time t² law) |
| Frozen tunnelling (5-4) | Zeno in a double well, spacing ≪ Rabi period | none | |
| Interaction-free rescue (5-3) | a "no" removes the half heading for a mine | none | |
| Slow glass (3-4) | a V-slab adds phase and delay; a pure phase plate only phase | phase-imprint tool | |
| Snell's law / potential lens / FTIR | a step bends a beam (n = √(1 − 2V/k²)); a negative disc focuses; a gap is a tunable splitter | none (rotated rects, negative V) | |
| Landau–Zener | slow packets follow an avoided crossing, fast ones jump: P = exp(−2πΔ²/(vα)) | none (overlapping zeeman + rotator) | best speed sets a target mixture |
| Pancharatnam–Berry phase | a polarization loop on the Poincaré sphere shifts the fringes by half its solid angle | none (waveplates in a 3-2 arm) | about 4:1 with the 8 % leak |
| Larmor clock | a weak rotator in a barrier times the tunnelling (Hartman effect) | none | a showcase rather than a puzzle |
| Zener tunnelling | a stronger push lets part of the atom jump the gap and run away round the ring (Landau–Zener across the gap Δ; here Δ = 1.25 keeps it negligible) | none (9-2 machinery) | Bloch itself is built (9-2) |
| Bragg diffraction (time domain) | at the Bragg angle a long weak pulse sends all into one order (vs Kapitza–Dirac's symmetric orders) | none (7-1 element, launch angle) | one-order k target |
| Fermions / Pauli | 8-1 with fermions: always one on each side; empty diagonal | none (`particles: "fermions"`) | needs a puzzle; fermions are T-independent at a symmetric wall |
| Collisions entangle | a V(x₁ − x₂) diagonal ridge; a detector strip on x₁ collapses particle 2 (EPR) | none (two-particle levels + detectors) | ledger shows the branches |
| Bell / CHSH | two particles with polarization | N-component spinor (4) | generalise `comps()` |
| Delayed choice | close the second splitter after the packet passed the first | none (gates) | statistics unchanged; weak as a puzzle |
| Aharonov–Bohm around a solenoid in the plane | phase from an enclosed flux, with a 2D geometry | Peierls kinetic term (after WebGPU) | review §2; the ring version is built (9-1) |
| Box revivals in a hard-walled box | full / half / quarter revivals with reflecting walls (the ring version is 9-6) | a small L with walls | T_rev = 4L²/π |
| Bohmian trajectories | an overlay, not a level | renderer | |

### 8.1 Game dynamics from the boundary: portals (periodic) vs drains (absorbing)

Per-level `boundary` is built (see §2). These ideas build on it; the numbers are
estimates, not yet prototyped.

| Idea | Lesson | Engine | Notes |
|---|---|---|---|
| **Ring interferometer with a flux dial** (built: 9-1, as a Sagnac loop mirror) | Aharonov–Bohm / Sagnac: halves of a packet go round a periodic axis in opposite directions and meet on the far side; a twist phase θ per lap (an enclosed flux, or a rotation) shifts the fringe there; θ = π swaps bright and dark with no local field | twist θ: kinetic phase with (k + θ/L)², recomputed when θ changes; a θ slider | meeting after half a lap ≈ 20/k, about 10 time units; interior optimum in θ; removes the Peierls blocker for AB in the narrow ring geometry |
| **Dial the allowed momenta** (built: 9-3) | on a ring only k = (2πn + θ)/L exist (spacing 0.157 at L = 40); a k-space target between two allowed values is unreachable at θ = 0; θ = π is the antiperiodic ("Möbius") world where k = 0 is forbidden | twist θ, momentum targets | topology decides the spectrum |
| **On a ring a push is a flux** (built: gauge force, and 9-2 for Bloch; the EMF ramp is the same mechanic, the player's tilt along a ring, so it needs no tool of its own) | Faraday: the only seamless kick on a ring is a change of flux. A constant force is a flux growing linearly in time, θ(t) = F·L·t: exact, no sawtooth. With a periodic lattice: **exact Bloch oscillations in an infinite crystal** (unblocks the parked level, §5). A real-time flux ramp is an EMF around the ring: the betatron principle, acceleration with no local push | time-dependent twist (one phase multiply per step); `field` along a periodic axis then becomes legal | Bloch: T_B = 2π/(F a); Zener from the gap size; no classical trapping escape route since the box no longer limits the excursion |
| **Portal or drain, switched in real time** (built: `drains`; 9-5 which-way by leaving / interaction-free measurement; 9-7 velocity selector, scored post-selected since absorbing can never raise an absolute P_T) | each side a gate between portal and drain. *Velocity selector*: fast components reach the edge first, so a briefly opened drain cuts a slice of momentum (pairs with k-space targets). *Which-way by leaving*: one half of a split packet would wrap round and spoil a fringe; draining it restores the fringe at the cost of its probability, keeping it keeps the interference: a trade-off with an interior optimum. *Closed vs open*: in a portal world nothing ever leaves, mines must be dodged forever; a drain is an environment that records the escape | a gate carrying one side's share of the boundary absorber (gates already take W) | drain loss counts as lost, like shutters |
| **Infinite gratings** | Kapitza–Dirac, Talbot and Bragg in a truly infinite crystal | done for 7-1 and 7-2 | Bragg (7-3) needs its transmitted beam to leave, so it stays absorbing |
| **Two particles on a ring** (built: 9-4 total momentum, 9-8 a bound pair in the loop mirror (h/2e), 9-9 the fermion parity effect. For a tightly bound pair exchange statistics play no role; they enter through the Pauli principle on the comb, as in 9-9) | with x and y periodic, ψ(x₁, x₂) lives on a torus; with a flux, bosons and fermions on a ring see shifted spectra (the exchange phase meets the Aharonov–Bohm phase), a doorway to anyon-flavoured levels | twist θ on both axes | niche |
| **Box revivals on a short ring** (built: 9-6, on a torus with L = 10, T = 31.8; `grid.L` is per level, so no non-square grid was needed) | a packet on a ring of length ℓ revives at ℓ²/π; a flux moves the revival | none | |
