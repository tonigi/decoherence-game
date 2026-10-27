# Born Rule

A wavefunction puzzle game. Each level gives you a potential landscape, an initial wavepacket and a target. You shape how ψ evolves, then pick the moment to measure. Waiting lets the packet travel *and* disperse, so the puzzle is arranging constructive interference over the target at the right time, and observing then.

Prototype scope: chapters 1-4 (free propagation, tunnelling, interference, bound states) plus chapter 5's region detectors (which-way information, Zeno freezing). 13 levels.

## Run

No build step, no dependencies (ES modules, so serve over HTTP):

```sh
npm start          # python3 -m http.server 8000  ->  http://localhost:8000
npm test           # physics + game-logic tests (node:test)
npm run verify     # every level: reference reaches 2 stars, naive play stays below 1 star
npm run solve -- levels/2-2.json   # random-restart optimiser over the setup parameters
```

## Controls

| | |
|---|---|
| Levels | drop-down in the header (grouped by chapter, with your stars), ◀ ▶ or `[` `]` for previous / next |
| Setup | drag the packet (position) and every editable property on the playfield: the arrow head (momentum k₀), the round handle on the dashed ring (width σ); select a placed item to get square handles for width / height / radius and a ◆ stalk above it for its strength (V, or a detector's measurement strength). Sliders mirror all of them. Add items from the inventory, drag them, `Del` removes |
| `Space` | play / pause (starts the run from setup) |
| `Enter` | **Observe**: sample |ψ|², collapse, win or lose. At `t_max` the world observes for you |
| click (while running) | **Kick**: momentum impulse toward the cursor, limited charges |
| arrows / WASD | **Field tilt**: uniform force while held |
| `1`-`9` | gates toggle; detectors fire (hold the key to pulse a "hold" detector repeatedly) |
| `R` | back to setup, same dice. `V` cycles view (domain colouring / |ψ|² / momentum |φ(k)|²), `C` current arrows, `G` ghost preview |

Win condition (hybrid): the live meter shows P_T = ∫_T |ψ|². The observation is a genuine Born-rule sample (P(hit) = P_T exactly); a hit wins, and **stars come from the skill score**, so skill is rewarded even when the dice are unkind. Without detectors the score is P_T at the moment of observation. If a detector fired, a single run's P_T is post-selected by the detector outcomes (a lucky "yes" can drop the packet onto the target), so the score is the **branch ledger** instead: P_T averaged over every detector outcome of your inputs (`src/ledger.js`). Mines are anti-targets. Probability absorbed at the boundary is a loss branch of the observation. "Expectation mode" wins iff the score ≥ the level's threshold, with no roll; it is fixed for the whole run and keeps its own stars.

## Design notes (how this maps to the plan)

* **Solver.** 2D TDSE, ħ = m = 1, split-step Fourier with Strang splitting (V/2 → T → V/2), `src/sim.js`. Exactly unitary without the absorber (tested to 1e-10). Runs on the CPU in plain JS on a 128² grid (64² for the ghost preview and the solver); the structure maps directly onto a WebGPU port, which is the obvious next step for 256²/512² showcase levels.
* **Boundaries.** Smooth quadratic complex absorbing potential, 6 length units wide. Absorbed probability = 1 − norm, shown as "lost".
* **Momentum ceiling.** k_max = π/dx = 10 here. Levels keep launch speeds ≤ 0.6 k_max (checked by a test); a "momentum budget" meter measures the probability above 60 % of Nyquist and flags aliasing.
* **Smooth everything.** Potentials and projector masks use tanh edges of fixed physical width (`SOFTNESS` = 0.45 units at every resolution, so the 64² ghost and solver see the same barriers as the 128² game: tunnelling agrees to 3 %, which a test checks). Rects can be rotated (`angle`), which gives 45° beam splitters and mirrors. The tunnelling test compares the simulated transmission with an exact 1D integration through the *rasterised* barrier (3 % agreement).
* **Measurement.** Position: draw u ∈ [0,1); u ≥ norm means "already absorbed"; otherwise invert the cumulative |ψ|² and collapse by multiplying ψ by a Gaussian of width σ_m = 1 (not a delta) and renormalising. Detectors use Kraus operators M_yes = m, M_no = √(1−m²) with a smooth mask m, so M_yes² + M_no² = 1; a "no" is an interaction-free measurement that carves ψ out of the detector region. A test checks that P_T is a martingale under a detector firing.
* **Branch ledger.** After a run with detector firings, the run's open-loop inputs are replayed on 64², splitting every branch into M_yes ψ / M_no ψ (weights p, 1−p) at each firing; kicks, tilt and gates act on all branches alike (`Sim.step(n, others)` steps them in lock-step). One-shot detectors give an exact 2-branch average. Pulsed (Zeno) detectors double the tree on every pulse, so beyond 16 branches the ensemble is compressed to the 16 leading eigenvectors of its density matrix ρ = Σ w |ψ⟩⟨ψ| (via the small Gram matrix; everything downstream is linear in ρ, so this is the best rank-16 approximation and the discarded eigenvalue weight bounds the score's error, typically ~1 %). It is deterministic, matches the exact tree and Monte Carlo, and costs about 2 s for 48 pulses. Detectors may have a `strength` s < 1 (weak measurement: M_yes = √s·m, M_no = √(1 − s m²)), which the same machinery handles.
* **Determinism.** A session is `(level, setup, seed, event log)`. All dice come from one seeded PRNG and all events are applied at integer step boundaries, so `replay()` reproduces a run exactly (`Copy replay JSON` on the result banner; `node tools/verify.js --replay file.json` re-verifies headlessly). The CPU build is a natural reference for verifying GPU-played leaderboard runs.
* **Level format.** `levels/*.json`: grid, `launch` ranges (`[value, min, max]` = editable), static `elements` (rect with optional `angle` / disc / slit wall / `harmonic` well {x, y, omega, R}, drawn as equipotential rings, optionally a toggleable `gate` (with `ramp` steps; a gated `harmonic` well is a trap you pulse, a gated `absorb` element an absorbing shutter whose loss counts as lost); `absorb: W` makes an element an absorbing bomb, whose swallowed probability counts as a mine), `detectors`, `inventory` (items, kick charges, tilt), `targets`, `mines`, star thresholds, a `reference` solution and a `naive` one (what ignoring the level's mechanic gives; observed at its best moment when it has no `observeAt`). `verify.js` requires reference ≥ 2 stars and naive < 1 star, so every level demonstrably rewards its lesson; `"naive": false` with a `naiveSkip` reason opts out. `minObserveTime` = `tmax` makes the observation time fixed. `"observe": "momentum"` makes the final measurement a momentum measurement: targets and mines are then regions of k-space (`x`, `y` = kx, ky), and `kView` zooms the momentum view.
* **Solver-assisted design.** `tools/solve.js` is a derivative-free optimiser (random restarts + (1+λ) search) over launch and inventory parameters. It was used to check that every level is solvable and to calibrate the star thresholds from the achievable P_T. The adjoint-gradient version is the planned upgrade (the dynamics are linear and differentiable), enabling hints and difficulty ratings by optimum sharpness.
* **Ghost preview.** Optional low-res forward simulation of the current launch (no real-time actions) drawn as a faint P_T(t) curve.

## Levels

| | |
|---|---|
| 1-1 Rendezvous | measured at t = 10 sharp: speed is set by the distance, the width optimum is σ₀ = √(t/2) |
| 1-2 Between the Mines | aiming with a mine on each side; choosing when to observe |
| 1-3 Nudge | kicks and field tilt |
| 1-4 Sharp Momentum | a momentum measurement: σ_x·σ_k ≥ ½ wants a wide packet, the edges of the world want a narrow one |
| 2-1 Thin Wall | tunnelling vs energy |
| 2-2 Mirror | place a barrier; leakage goes to the mines |
| 3-1 Two Slits | fringes, mines on the dark fringes |
| 3-2 Mach–Zehnder | 45° splitters and mirrors; a phase plate swaps the bright and dark ports |
| 4-1 Coherent State | harmonic well: only σ₀ = 1/√(2ω) swings without breathing |
| 4-2 Fourier Lens | a quarter period swaps x and k: a wide packet focuses to 1/(2ωσ); finite aperture |
| 4-3 Delta-Kick Cooling | a timed harmonic pulse (gate) removes the x–k correlation of an expanding packet: 7 % → 80 % in a k = 0 target |
| 5-1 Which Way? | on the same interferometer, a which-path detector lights up the dark port |
| 5-2 Hold Still | Zeno freezing with a pulsed detector; the detector size has an interior optimum |

3-1 has intrinsically small P_T (a slit screen and 2D diffraction spread the probability), so its star thresholds are low and it is exempt from the naive check; the Mach–Zehnder levels keep the probability in two beams and carry the interference lessons. See `docs/mechanics-review.md` for the review behind these levels and the roadmap.

## Not yet built

Box revivals, weak measurement as a player tool, a bomb-tester level (the absorbing-element mechanic is in, but the interferometer's dark port leaks ~8 %, see the review), Aharonov-Bohm levels, spin and entanglement chapters, Bohmian trajectories, a level editor, WebGPU backend, adjoint solver. The `momentum` view already shows |φ(k)|² for chapter 6.
