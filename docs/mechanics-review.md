# Mechanics review and proposals

> **Status (first round of fixes done).** §1.1 5-1 and 3-2 rebuilt on a Mach–Zehnder
> (rotated rects, M1). §1.2 detector runs are scored by the branch ledger (`src/ledger.js`).
> §1.3 expectation mode is locked per run and has its own stars. §1.4 1-1 is now
> "Rendezvous" (fixed observation time, interior optimum). §1.5 fixed `SOFTNESS` = 0.45
> at all resolutions. §1.6 hit/mine sampling is exact. §1.7 `naive` check in `verify.js`.
> 5-2 recalibrated (its old thresholds came from 16 lucky dice; the true expected score of
> the old reference was ≈ 0.35, below its 2-star line). Still open: 3-1 (exempted from
> the naive check; see §3), and everything in §2–3 beyond M1.
>
> **Second round.** M2 done: `"observe": "momentum"` levels with k-space targets, a
> zoomed momentum view, and level **1-4 Sharp Momentum** (σ = 1 gives 12 %, the optimum
> σ ≈ 5 gives 82 %). Absorbing elements (`absorb: W`, exact bookkeeping of the swallowed
> probability, which counts as a mine and as a "boom" outcome) are in for the bomb tester,
> but **3-5 Bomb Tester is blocked**: the dark port of the 45° Mach–Zehnder leaks about
> 8–10 % (visibility ≈ 0.6–0.7), so blocking an arm only raises it from 0.10 to 0.13.
> The diagnosis: the two paths meet with the right phase (≈ 174°) but only about 70 %
> mode overlap, because the splitter is strongly energy-dependent (T rises from 0.39 to
> 0.59 between k = 2.7 and 3.3). Reflection therefore picks out slower, more oblique
> components, and the reflected packet lags by about 0.7 and sits about 1.1 off-axis.
> The dt-convergence check is clean, so this is the physics of a barrier about one unit
> thick. The fix is a thinner, delta-like splitter, which needs edges sharper than
> `SOFTNESS` and hence a finer grid (the 256² WebGPU path), or a larger k with the ghost
> run at 128².
>
> **Third round.** M7 (harmonic well element, drawn as equipotential rings) and chapter 4:
> **4-1 Coherent State** (σ₀ = 1/√(2ω) is the only width that does not breathe; 65 %
> vs 31 % for the default; matches the analytic width law to ~3 %) and **4-2 Fourier
> Lens** (focus to 1/(2ωσ) at T/4 with a finite aperture; 70 % vs 21 %).
>
> **Fourth round.** M5 (gates as player tools): per-gate `ramp`, gated harmonic traps
> and absorbing shutters. **4-3 Delta-Kick Cooling**: pulsing the trap at the right
> time and for the right length removes the x–k correlation of an expanding packet (k = 0
> target: 7 % → 80 %; leaving the trap on and measuring at T/4 is the same phase-space
> rotation, an intended second solution). **2-6 Shutter was tried and dropped.** A
> reflecting shutter mostly pumps energy into the wave (raising V under it) and traps it
> in a cavity. An absorbing chopper is clean "diffraction in time", but chopping throws
> away most of the packet: best P_T ≈ 3 % against 1.7 % with the shutter simply open.
>
> **Fifth round.** M6 weak detectors (`strength` s: M_yes = √s·m). While testing them
> the ledger's resampling turned out to be the weak point: it was unbiased but had a
> large spread (σ ≈ 9 points at K = 16, 8 pulses), and a cut-search bug silently dropped
> weight when branch weights were nearly equal. It is replaced by a deterministic
> **density-matrix compression**: beyond K = 16 branches the ensemble is replaced by the
> K leading eigenvectors of ρ = Σ w|ψ⟩⟨ψ|. That is the best rank-K approximation, and
> the discarded eigenvalue weight bounds the error. It matches the exact 256-branch tree
> to 0.01 % and Monte Carlo within error bars, at about 2 s for a 48-pulse Zeno run.
> No level uses weak detectors yet: with a single P_T objective, Zeno's score rises
> monotonically with s for a well-sized detector and is flat for a small one. An
> information-vs-disturbance level needs a two-part objective (for example the
> eraser of M8).
>
> **Sixth round.** UI: a chapter-grouped level drop-down replaces the button bar, and
> every editable setup property has a playfield handle (arrow head for k₀, a ring
> handle for σ, edge handles for item sizes, a stalk for V or detector strength).
> M3 done: a **Branches** panel after detector runs (run-length outcome histories,
> Born weights, per-branch P_T; click to view that branch's wave function). M9 started:
> live Δx·Δkₓ (≥ ½) and ⟨E⟩ readout.
>
> **Seventh round.** M8 spinor solver: ψ = (ψ_H, ψ_V), optics as a sparse per-cell
> exact 2×2 exponential of h₀ + h·σ (complex h, so polarizers are non-Hermitian
> projectors). Validated: the exponential matches a 40-term series to 1e-12; optics
> without absorption conserve the norm to 1e-10; a uniform rotator precesses exactly;
> an absorbing polarizer (W = 6, 2 units) gives T(θ)/T(0) = 0.750 / 0.500 / 0.250 at
> 30° / 45° / 60°, leaves the packet on its axis (±0.5°), leaks 0.03 % crossed and
> reflects ~1 %; a reflecting polarizer (V = 12) splits a 45° packet 0.49 / 0.51 into
> pure H / V; 64² agrees with 128² to < 1 %. Chapter 6 levels: **6-1 Three
> Polarizers** (30°/60° in order 22.9 %, one at 45° 13.5 %, reversed 2.7 %, none 0.03 %),
> **6-2 Watched Pot** (polarization Zeno; thin polarizers follow cos^{2(N+1)}(π/2(N+1))
> within 1–3 %: 0.24 / 0.42 / 0.55 / 0.63 for N = 1…4 against 0.25 / 0.42 / 0.53 / 0.61;
> thicker ones beat the ideal law, because inside an absorbing polarizer the rotation is
> watched continuously; three bunched polarizers give 0.30 against 0.55 equally
> spaced) and **6-3 Half-Wave** (retardance δ·w/v; the plate thickness has an interior
> optimum at w = πv/δ ≈ 3.9: 0.525 against 0.28 for a quarter-wave plate). The first
> 6-3 draft let the player tune k instead of thickness and had a "max the speed
> slider" optimum (capture grows with speed), so it was changed. A quantum-eraser
> level was considered and deferred: erasure only removes the dark fringes and never
> raises P_T above the incoherent sum, so it needs a two-part objective.
>
> **Eighth round.** Stern–Gerlach and Kwiat's bomb tester. A `zeeman` optic is
> g·v·n(θ)·σ (v across the magnet): a 60° packet through an axis-0 magnet goes
> 0.25 up / 0.75 down, through an aligned one 0.98 up (the rest is the upper beam's
> tail), and the two beams carry the axis and the crossed polarization (±3°). **6-4**:
> align the axis and aim with the gradient (interior optimum g ≈ 0.35–0.4; 27 %, axis
> 45° gives 24 %, axis 0 gives 6.5 % with 20 % on the mine). The optimiser first beat
> the reference (0.36) by moving the magnet off-axis vertically, a second hidden aiming
> knob, so the magnet's height is now fixed. **6-5**: the first design (6-2's
> continuous rotator with 45°-tilted reflecting splitters sending V up into a bomb)
> beat the ideal Zeno law by far (0.85 vs 0.61 at N = 4; three bunched splitters beat
> equal spacing). A momentum/polarization decomposition showed why: V reflected inside
> the rotating medium keeps rotating, and between splitters it leaks H forward (a
> cavity). Absorbing polarizers follow the ideal law in the same geometry. The level is
> therefore Kwiat's real arrangement unrolled: four discrete 22.5° plates and stations
> (PBS whose V port is the bomb, a `bomb` optic: what it absorbs is caught, exactly).
> Per look the booms are sin² of the angle turned (0.146, 0.50 measured), one station
> per gap gives 0.475 of the light (ideal cos⁸(π/8) = 0.531; the packet's 11 % speed
> spread blurs each plate), doubling up 0.36. The optimiser then parked stations
> *inside* plates (continuous Zeno during the rotation, 0.195 vs 0.152), so items got
> **placement zones** (`area` as a list of rects) that keep the stations in the gaps;
> with them the optimiser finds one per gap (0.160). `solve.js` needs `--net 0` here,
> because booms count in P_M.
>
> **Ninth round (textbook levels).** Experiment names shown to the player. State targets
> (projective fidelity) for **4-4 Bang-Bang** (96 % vs 0 %; the fidelity with B's ground
> state is conserved in B, so no timing exploit). **6-6 Humpty Dumpty** as a time-domain
> full-loop Stern–Gerlach (55 % vs 0 %); the spatial magnet loop failed (1–10 %: the edges
> tilt H and V apart). Lattice element: **7-1 Kapitza–Dirac** (J_n² orders, 65 %),
> **7-2 Talbot** with a pulsed phase grating (42 % vs 21 %; a slit grating caught only
> 1–5 %), **7-3 Bragg Mirror** (59 % vs 3 %). Two particles on a line: **8-1
> Hong–Ou–Mandel** (93 % vs 47 %). Bloch oscillations failed in the open box (Zener loss
> vs classical trapping).
>
> **Tenth round (portals).** Per-axis periodic boundaries; the gauge (k + g)² for a flux
> (twist) and for a force on a ring (a flux growing in time, no sawtooth); kinetic
> momentum everywhere; drains; post-selection; the `pair` bond; periodic-image launches.
> Chapter 9: **9-1 Loop Mirror** (Aharonov–Bohm in a Sagnac ring, 63 % vs 3 %), **9-2
> Push Less** (Bloch oscillations on a ring, 61 % vs 8 %), **9-3 Half Steps** (flux shifts
> the comb, 63 % vs 0 %), **9-4 Pairs** (total momentum, h/2e, 44 % vs 0 %), **9-5 Leak**
> (interaction-free measurement with a timed drain, 20 % vs 6 %), **9-6 Revival** (L = 10
> torus, 77 % vs 0 %), **9-7 Chopper** (post-selected velocity selection, 52 % vs 19 %),
> **9-8 Bound Pair** (window at Φ₀/8, 85 % vs 16 %), **9-9 Pauli Ring** (parity effect,
> 100 % vs 0 %). Details and the parked attempts are in `HANDOFF.md` §2.1, §5 and §8.
>
> **Eleventh round.** **6-7 Ask Again**, the sequential Stern–Gerlach experiment (HANDOFF
> §7.1a): an H beam, a fixed 0° magnet whose V port is the target, and one player magnet
> in between (30 % vs 0 %). P_T follows sin²2α exactly (29.5 / 22 / 7.4 / 0 % at
> 45 / 30 / 15 / 0°), and the gradient has an interior optimum: the V share matches
> ½(1 − e^(−2Δk²σ²)) to within 1 % (4.6 / 15 / 38 / 48 % at g = 0.05 / 0.1 / 0.2 / 0.3), so
> an unresolved split is no measurement. The fixed magnet out-pushes the player's (0.8
> against a cap of 0.5), which kills steering a 90° H beam onto the target (≤ 1 %); the
> first layout, with equal magnets, let that exploit score 26 %. Magnet gradients stay
> moderate because the entrance and exit edges kick the beam along its motion (§5 of
> HANDOFF). `solve.js` needs `--net 0` here (the H beam always lands on the mine).

Every number below comes from the current code (`src/session.js` and the 9 shipped
levels) on the 128² grid, unless it says otherwise.

## 1. Findings in the current mechanics

### 1.1 5-1 "Which Way?" rewards not playing the mechanic (level bug)

| 5-1 setup (observe at t ≈ 13) | P_T |
|---|---|
| reference: detector placed and fired at step 170 | 6.7 % (mean over 16 dice) |
| **same detector, never fired** | **7.5 %** |

Not firing beats the intended solution. It reaches 2 stars and almost 3, because the
thresholds are 3 / 5.5 / 8 %. The target is the same 6 × 17.5 rectangle used in 3-1.
It covers the dark centre *and* the bright side fringes, so destroying the interference
barely changes the integral.

The same thing weakens 3-2: P_T is 7.5 % with no plate, 7.8 % with the "obvious" mirror
plate (same slab over the other slit) and 9.6 % with the solver's odd off-axis plate.
3-1 with an unshifted k = 2 gives 8.6 %. So the phase flip moves P_T by about 1 point.

Shrinking the target to the central fringe (4 × 2.6) makes the lesson clear, but the
absolute numbers are tiny:

| narrow target on the centre | P_T |
|---|---|
| slab, coherent (dark fringe) | 0.27 % |
| slab, which-way detector fired | 0.64 % |
| no slab (bright fringe) | 1.6 % |

The contrast is right (×2.4 for decoherence, ×6 bright/dark), but 2D slit diffraction
throws almost all the probability away. Interference levels need a geometry that keeps
the probability (see §3, Mach–Zehnder).

### 1.2 Detectors let a player post-select their way to stars (scoring exploit)

Stars come from the *normalised* P_T after the detector outcomes. In 5-1 you can stretch
the detector (area x ≤ 28, w ≤ 12) over the target and fire it late. A "yes" (p ≈ 0.1)
renormalises ψ into the target, so about 1 run in 12 gets 3 stars by luck. The intended
solution gets 3 stars in 0 of 16. 5-2 shows the same thing: its 16 runs split 9 at
0 stars and 7 at 3 stars, with nothing in between.

Normalised P_T is an unbiased estimate of the strategy's win probability (the martingale
test proves exactly that), but its variance is huge. That contradicts the README's
promise that "skill is rewarded even when the dice are unkind".
**Fix:** score detector levels on the **branch-averaged** P_T. Fork the simulation at
every detection and keep running the counterfactual branch with the same open-loop input,
pruning branches whose weight is below ε. One-shot detectors only need 2 branches. For
Zeno, the "no" children can be scored as ≈ 0 without simulating them. This is also the
"branch ledger" mechanic in §2.

### 1.3 Expectation mode shares the star table

`optExpect` can be toggled mid-run (`ui.session.mode = ui.mode`), and `showResult` stores
stars no matter which mode was used. Expectation mode removes the final roll, so it is
strictly easier. Store its stars separately, or lock the mode once the run starts.

### 1.4 Optima sit on the slider limits

The reference solutions sit at the slider maximum for k in 1-1, 1-2 and 2-1, and for
both k and σ in 3-1. In 1-1 the claimed "width vs speed trade-off" does not exist: P_T
rises monotonically with k (k = 1.0 / 1.4 / 1.8 / 2.2 gives best P_T of
21 / 29 / 36 / 42 %), because a faster packet has less time to spread. The only real
optimum is σ₀ = √(T/2) for flight time T (2.33 here, reference 2.35). Players learn
"max the speed slider".
**Fix:** fix the observation time (add `maxObserveTime` and set it equal to
`minObserveTime`), or move the target. Then k is set by distance/T, and σ₀ = √(T/2) is
the whole lesson.

### 1.5 The ghost preview does not see the same barriers

`softness = max(0.35, 0.7·dx)` gives 0.44 at N = 64. The README says the edge width is
fixed at 0.35. Tunnelling depends on edge sharpness: the 2-1 reference gives 28.1 % in
the ghost and 25.4 % in the real run. Either use a constant 0.44 at every resolution or
run the ghost at 96². This matters most for chapter 2.

### 1.6 Smaller items

* The observation outcome uses a thresholded mask (`mask > 0.5`), while P_T uses the
  smooth mask linearly. These are almost equal for symmetric tanh edges, but "win
  probability = P_T" is not exact. Sample hit/mine by drawing a second uniform against
  `mask[idx]` to make it exact.
* **Gates are implemented and tested but no level uses them.** That is free content (§3).
* The 3-2 slab gives Δφ ≈ (k − √(k² − 2V))·w ≈ 2.7 rad, not π. It also **delays** the
  lower beam by about 0.9 time units (≈ 1.7 length units against a packet length of
  about 5.6). That partly separates the two arrivals in time, so the fringes are partly
  washed out by "which-time" information. This is an interesting lesson in its own right
  (§3, 3-4), but the intro text ("flipped") oversells it.
* The kick is a global boost, which is fine. A *localised* kick (phase gradient inside a
  mask, i.e. a thin prism) would be a more instructive tool.

### 1.7 Proposed guard rail for level design

Add a `naive` field next to `reference` in the level JSON: the setup a player gets by
ignoring the level's mechanic. Have `verify.js` require
`P_T(reference) ≥ stars[1]` **and** `P_T(naive) < stars[0]`. That check would have
caught 5-1 and the weak 3-2 contrast. Also flag a reference solution that sits on a
slider limit.

## 2. New mechanics

Ordered by teaching value per line of code.

| # | Mechanic | Implementation sketch | Teaches |
|---|---|---|---|
| M1 | **Rotated rect elements** (beam splitters, mirrors at 45°) | add `angle` to `rect` in `shapes.js` and rotate the local coordinates; about 5 lines | interferometers with O(1) P_T instead of 1–15 % |
| M2 | **Momentum measurement / k-space targets** | target masks over φ(k) (`momentumDensity` already exists); "Observe p" button | uncertainty, energy filtering by barriers, diffraction = Fourier transform |
| M3 | **Branch ledger** | fork `Sim` at each detection; side panel with the tree, branch weights and per-branch P_T; scores on the average (fixes §1.2) | Born-rule bookkeeping, unconditional vs post-selected probability, many-worlds intuition |
| M4 | **Pure phase imprint** (ideal thin plate, ψ ← e^{iφ·m}ψ, fired by a key or once when the centroid crosses it) | mask multiply, like `kick` | phase without group delay, to compare with a V-slab (phase *and* delay) |
| M5 | **Timed gates as a player tool** (already in the engine) | expose gates in the inventory with key bindings | time–energy uncertainty (diffraction in time), trapping and release |
| M6 | **Weak detector** (strength slider s: M_yes = √s·m, M_no = √(1 − s·m²)) | generalises `fireDetector` | the information vs disturbance trade-off; partial decoherence and fringe visibility |
| M7 | **Harmonic / lens element** (V = ½ω²r² inside a region) | new element type | coherent and squeezed states, Fourier lens (x ↔ k swap after T/4) |
| M8 | **Two-component spinor** | 2× cost; the kinetic step is shared; elements: spin-flip plate, Stern–Gerlach gradient | which-way tags *without* collapse, quantum eraser, the start of an entanglement chapter |
| M9 | **Educational HUD readouts** | σ_x·σ_k (≥ ½), ⟨E⟩ vs barrier height, fringe visibility in a strip, which-way distinguishability D with V² + D² ≤ 1 | turns the meters into the lesson |

Aharonov–Bohm (in the README's list) does not fit split-step Fourier cleanly. A branch-cut
gauge phase is not compatible with the spectral kinetic step, so it needs a Peierls
finite-difference kinetic operator. It is better left until after the WebGPU port.

## 3. Proposed levels

Each level has one lesson and an A/B contrast of at least ×2 in P_T between naive and
insightful play. That contrast becomes the `naive` check in §1.7.

**Chapter 1: free propagation**
* **1-1′ Rendezvous** (replaces 1-1). Observation only at t = 10 exactly, so k is forced
  and the optimum is σ₀ = √(T/2). The HUD shows σ(t) = σ₀√(1 + (t/2σ₀²)²).
* **1-4 Momentum Target** (M2). The target is a ring in k-space. A narrow packet in x
  cannot hit a narrow k-target: σ_x·σ_k ≥ ½.

**Chapter 2: tunnelling**
* **2-3 Energy Filter** (M2). Thin barrier, k-space target above k₀. Transmission is
  exponentially selective in energy, so the transmitted packet is *faster* than the one
  sent in.
* **2-4 Two Walls Are Thinner Than One**. A double barrier with a resonant quasi-bound
  level. Tune k with a wide (narrow-σ_k) packet. On resonance T → 1, well above either
  wall alone. Calibrate with `solve.js`, because it needs σ_k smaller than the resonance
  width.
* **2-5 Reflected Above the Wall**. E > V, but a potential step (or a well) still
  reflects. Target behind the source, so classical intuition says it is impossible.
* **2-6 Shutter** (M5). Time a gate to chop the packet. A short opening broadens the
  energy spread and lets part of the packet over a second, higher barrier
  (time–energy uncertainty).

**Chapter 3: interference (rebuilt on M1)**
* **3-1′ Two Slits**: keep it, with fringe-scale targets and mines.
* **3-3 Mach–Zehnder**: 50/50 splitters (thin barriers at 45° with T ≈ ½ at the given k)
  and two mirrors. The target is the bright port, a mine is the dark port; tune path
  length (or a plate) for P_T ≈ 0.8–0.9.
* **3-4 Slow Glass**: compare a V-slab with a pure phase plate (M4) of the same phase.
  The slab also delays its beam, and that "which-time" information reduces the fringe
  visibility. Fix it by making the slab longer but lower (same phase, less delay).
* **3-5 Bomb Tester** (Elitzur–Vaidman). A mine (or a detector) sits in one arm. The
  target is the dark port, which can only be reached because the other arm is blocked.
  The fraction is 25 % for a 50/50 splitter, and the player can raise it by changing the
  splitter reflectivity (barrier height).

**Chapter 4: bound states and revivals (M7 plus high walls)**
* **4-1 Coherent State**: harmonic well, choose σ = 1/√(2ω). Any other σ makes the packet
  "breathe" (squeezed state), and the target is a sliver at the turning point.
* **4-2 Fourier Lens**: a harmonic region maps x → k after a quarter period. Send two
  separated packets; the target is the fringe pattern that appears at T/4.
* **4-3 Wait For It**: packet in a box, target on the far side. Observe at the full
  revival T_rev = 4L²/π (ħ = m = 1), or at T/2 (mirror image), or at T/4 (two copies, a
  cat state) when two targets are offered.

**Chapter 5: measurement**
* **5-1′ Which Way?**: on the Mach–Zehnder from 3-3, with the target at the dark port.
  Coherent play gives about 0 %, and a which-path detector in one arm gives 25 %,
  shown in the ledger (M3) as two branches.
* **5-3 Interaction-Free Rescue**: a mine sits in the path of half the packet. Fire a
  detector over that half; "no" (the likely result, by design) removes the dangerous
  half without any contact. It is the mirror image of the Zeno level.
* **5-4 Frozen Tunnelling**: a symmetric double well with tunnelling (Rabi) period T.
  Keep the particle on the left until t = T using pulsed "left?" measurements. The
  pulse spacing must be ≪ T; spacing ≈ T/2 is too slow. A clean Zeno law with a time
  scale the player can read off the meter.
* **5-5 Fringe Dial** (M6). A weak which-way detector with a strength slider. The target
  mixes a fringe region and a which-way readout, so the best score sits at intermediate
  strength. The HUD shows V² + D² ≤ 1.
* **5-6 Eraser** (M8). Spin-flip plates tag the paths and the fringes vanish; a
  diagonal spin filter before the screen brings them back (in the post-selected half).
  The ledger shows that the unconditioned pattern never changed.

## 4. Suggested order of work

1. Fix §1.2 scoring (branch average), §1.3 and §1.5, and add the `naive` check (§1.7);
   re-tune 1-1, 3-2 and 5-1.
2. M1 (rotated elements) gives 3-3, 3-5 and 5-1′, the biggest gain in instructiveness.
3. M2 and M5 (k-targets, gate tools) give 1-4, 2-3 and 2-6 with almost no new physics code.
4. M7 enables chapter 4; M3 ledger UI; M6; M8 spinor last.
