Decoherence (Prototype)

Run

- Serve locally (ES modules are blocked on file://):
  - python3 -m http.server
  - Open http://localhost:8000 in a modern browser.

Controls

- Movement: WASD or arrow keys.
- Win: reach the detector rectangle on the right.
- Lose: coherence reaches zero.
- Tuning panel: click the ⚙️ button (top-right) to open.

Tuning Panel (live parameters)

- Simulation
  - dt: time step per update (stability: try 0.008–0.02).
  - substeps: simulation steps per frame (1–16).
- Renderer
  - gamma: tone curve for intensity.
  - percentile: adaptive white point (0.5–0.999).
  - regen alpha/bright: strength/brightness of regen highlight.
  - outline intensity: boundary edge boost around regen regions.
- Player
  - base speed, min/max speed factors.
- Coherence
  - min/max drain, regen threshold, regen rate.
- Potential (Double Slit)
  - barrier thickness, barrier V, slit height, slit separation, slit offset Y.
  - Apply Potential to rebuild the field.
- Absorb Mask
  - margin, strength (Apply Absorb).
- Seed (Gaussian)
  - sigma, kx, ky (Reseed).

Rendering

- Phase hue: hue = atan2(Im, Re) mapped around the color wheel.
- Intensity value: ∣Ψ∣² tone-mapped using the 95th percentile white point + gamma.
- Regen overlay: mint tint + boundary outline where density exceeds the regen threshold.

Notes

- If visuals clip, lower percentile or raise gamma.
- If unstable or too fast, lower dt or substeps.
- Works in CPU mode; GPU/WebGL path is planned for later.

