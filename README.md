# Born Rule

A wavefunction puzzle game. Each level gives you a potential landscape, an initial wavepacket and a target. You shape how ψ evolves, then pick the moment to measure. Waiting lets the packet travel *and* disperse, so the puzzle is arranging constructive interference over the target at the right time, and observing then.

Prototype scope: chapters 1-3 (free propagation, tunnelling, interference) plus chapter 5's region detectors (negative results, which-way information, Zeno freezing). 9 levels.

## Run

No build step, no dependencies (ES modules, so serve over HTTP):

```sh
npm start          # python3 -m http.server 8000  ->  http://localhost:8000
npm test           # physics + game-logic tests (node:test)
npm run verify     # replay every level's reference solution, check it reaches the 2-star threshold
npm run solve -- levels/2-2.json   # random-restart optimiser over the setup parameters
```

## Controls

| | |
|---|---|
| Setup | drag the packet (position), drag the arrow head (momentum k₀), sliders for σ; add inventory items, drag them, tune with sliders, `Del` removes |
| `Space` | play / pause (starts the run from setup) |
| `Enter` | **Observe**: sample |ψ|², collapse, win or lose. At `t_max` the world observes for you |
| click (while running) | **Kick**: momentum impulse toward the cursor, limited charges |
| arrows / WASD | **Field tilt**: uniform force while held |
| `1`-`9` | gates toggle; detectors fire (hold the key to pulse a "hold" detector repeatedly) |
| `R` | back to setup, same dice. `V` cycles view (domain colouring / |ψ|² / momentum |φ(k)|²), `C` current arrows, `G` ghost preview |

Win condition (hybrid): the live meter shows P_T = ∫_T |ψ|². The observation is a genuine Born-rule sample; a hit wins, and **stars come from P_T at the moment of observation**, so skill is rewarded even when the dice are unkind. Mines are anti-targets. Probability absorbed at the boundary is a loss branch of the observation. "Expectation mode" wins iff P_T ≥ the level's threshold, with no roll.

## Design notes (how this maps to the plan)

* **Solver.** 2D TDSE, ħ = m = 1, split-step Fourier with Strang splitting (V/2 → T → V/2), `src/sim.js`. Exactly unitary without the absorber (tested to 1e-10). Runs on the CPU in plain JS on a 128² grid (64² for the ghost preview and the solver); the structure maps directly onto a WebGPU port, which is the obvious next step for 256²/512² showcase levels.
* **Boundaries.** Smooth quadratic complex absorbing potential, 6 length units wide. Absorbed probability = 1 − norm, shown as "lost".
* **Momentum ceiling.** k_max = π/dx = 10 here. Levels keep launch speeds ≤ 0.6 k_max (checked by a test); a "momentum budget" meter measures the probability above 60 % of Nyquist and flags aliasing.
* **Smooth everything.** Potentials and projector masks use tanh edges of fixed physical width (0.35 units, so the low-res ghost sees the same barriers as the main sim). The tunnelling test compares the simulated transmission with an exact 1D integration through the *rasterised* barrier (3 % agreement).
* **Measurement.** Position: draw u ∈ [0,1); u ≥ norm means "already absorbed"; otherwise invert the cumulative |ψ|² and collapse by multiplying ψ by a Gaussian of width σ_m = 1 (not a delta) and renormalising. Detectors use Kraus operators M_yes = m, M_no = √(1−m²) with a smooth mask m, so M_yes² + M_no² = 1; a "no" is an interaction-free measurement that carves ψ out of the detector region. A test checks that P_T is a martingale under a detector firing.
* **Determinism.** A session is `(level, setup, seed, event log)`. All dice come from one seeded PRNG and all events are applied at integer step boundaries, so `replay()` reproduces a run exactly (`Copy replay JSON` on the result banner; `node tools/verify.js --replay file.json` re-verifies headlessly). The CPU build is a natural reference for verifying GPU-played leaderboard runs.
* **Level format.** `levels/*.json`: grid, `launch` ranges (`[value, min, max]` = editable), static `elements` (rect / disc / slit wall, optionally a toggleable `gate`), `detectors`, `inventory` (items, kick charges, tilt), `targets`, `mines`, star thresholds and a `reference` solution.
* **Solver-assisted design.** `tools/solve.js` is a derivative-free optimiser (random restarts + (1+λ) search) over launch and inventory parameters. It was used to check that every level is solvable and to calibrate the star thresholds from the achievable P_T. The adjoint-gradient version is the planned upgrade (the dynamics are linear and differentiable), enabling hints and difficulty ratings by optimum sharpness.
* **Ghost preview.** Optional low-res forward simulation of the current launch (no real-time actions) drawn as a faint P_T(t) curve.

## Levels

| | |
|---|---|
| 1-1 Free Flight | dispersion trade-off between width and speed |
| 1-2 Between the Mines | aiming with a mine on each side |
| 1-3 Nudge | kicks and field tilt |
| 2-1 Thin Wall | tunnelling vs energy |
| 2-2 Mirror | place a barrier; leakage goes to the mines |
| 3-1 Two Slits | fringes, mines on the dark fringes |
| 3-2 Phase Shift | a phase slab flips the fringes; fix it with your own plate |
| 5-1 Which Way? | which-path detector destroys the interference at a dark target |
| 5-2 Hold Still | Zeno freezing with a pulsed detector |

Interference levels have intrinsically small P_T (a slit screen and 2D diffraction spread the probability), so their star thresholds are low; expectation mode is there for that.

## Not yet built

Chapter 4 (harmonic lenses, box revivals), momentum measurement and weak measurement as player tools, Aharonov-Bohm levels, spin and entanglement chapters, Bohmian trajectories, a level editor, WebGPU backend, adjoint solver. The `momentum` view already shows |φ(k)|² for chapter 6.
