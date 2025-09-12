export class Controls {
  constructor({ sim, renderer, player, coherence, config, potentialParams, absorbParams, seedParams, rebuildPotential, rebuildAbsorb, reseed, setSubsteps }) {
    this.sim = sim;
    this.renderer = renderer;
    this.player = player;
    this.coherence = coherence;
    this.config = config;
    this.potentialParams = potentialParams;
    this.absorbParams = absorbParams;
    this.seedParams = seedParams;
    this.rebuildPotential = rebuildPotential;
    this.rebuildAbsorb = rebuildAbsorb;
    this.reseed = reseed;
    this.setSubsteps = setSubsteps;
    this._bind();
  }

  _num(id) { return parseFloat(document.getElementById(id).value); }
  _int(id) { return parseInt(document.getElementById(id).value, 10); }
  _set(id, v) { document.getElementById(id).value = v; }

  _bind() {
    // Initialize values
    // Simulation
    this._set('dtInput', this.config.dt);
    this._set('substepsInput', this.config.substeps);
    // Renderer
    this._set('gammaInput', this.renderer.gamma);
    this._set('percentileInput', this.renderer.percentile);
    this._set('overlayAlphaInput', this.renderer.regenOverlayAlphaMax);
    this._set('overlayBrightInput', this.renderer.regenOverlayBrightMax);
    this._set('outlineInput', this.renderer.outlineIntensity);
    // Player
    this._set('baseSpeedInput', this.player.baseSpeed);
    this._set('minFactorInput', this.player.speedProfile.minFactor);
    this._set('maxFactorInput', this.player.speedProfile.maxFactor);
    // Coherence
    this._set('minDrainInput', this.coherence.minDrain);
    this._set('maxDrainInput', this.coherence.maxDrain);
    this._set('regenThreshInput', this.coherence.regenThreshold);
    this._set('regenRateInput', this.coherence.regenRate);
    // Potential (double slit)
    this._set('barrierThicknessInput', this.potentialParams.barrierThickness);
    this._set('barrierVInput', this.potentialParams.barrierV);
    this._set('slitHeightInput', this.potentialParams.slitHeight);
    this._set('slitSepInput', this.potentialParams.slitSeparation);
    this._set('slitOffsetInput', this.potentialParams.slitOffsetY || 0);
    // Absorb
    this._set('absorbMarginInput', this.absorbParams.margin);
    this._set('absorbStrengthInput', this.absorbParams.strength);
    // Seed
    this._set('seedSigmaInput', this.seedParams.sigma);
    this._set('seedKxInput', this.seedParams.kx);
    this._set('seedKyInput', this.seedParams.ky);

    // Wire events
    document.getElementById('dtInput').addEventListener('change', () => {
      const v = Math.max(0.001, Math.min(0.05, this._num('dtInput')));
      this.sim.setDt(v);
      this.config.dt = v;
    });
    document.getElementById('substepsInput').addEventListener('change', () => {
      const v = Math.max(1, Math.min(16, this._int('substepsInput')));
      this.setSubsteps(v);
      this.config.substeps = v;
    });

    document.getElementById('gammaInput').addEventListener('change', () => {
      this.renderer.gamma = Math.max(0.2, Math.min(2.2, this._num('gammaInput')));
    });
    document.getElementById('percentileInput').addEventListener('change', () => {
      this.renderer.percentile = Math.max(0.5, Math.min(0.999, this._num('percentileInput')));
    });
    document.getElementById('overlayAlphaInput').addEventListener('change', () => {
      this.renderer.regenOverlayAlphaMax = Math.max(0, Math.min(1, this._num('overlayAlphaInput')));
    });
    document.getElementById('overlayBrightInput').addEventListener('change', () => {
      this.renderer.regenOverlayBrightMax = Math.max(0, Math.min(1, this._num('overlayBrightInput')));
    });
    document.getElementById('outlineInput').addEventListener('change', () => {
      this.renderer.outlineIntensity = Math.max(0, Math.min(4, this._num('outlineInput')));
    });

    document.getElementById('baseSpeedInput').addEventListener('change', () => {
      this.player.baseSpeed = Math.max(1, Math.min(200, this._num('baseSpeedInput')));
    });
    document.getElementById('minFactorInput').addEventListener('change', () => {
      this.player.speedProfile.minFactor = Math.max(0, Math.min(5, this._num('minFactorInput')));
    });
    document.getElementById('maxFactorInput').addEventListener('change', () => {
      this.player.speedProfile.maxFactor = Math.max(0.1, Math.min(10, this._num('maxFactorInput')));
    });

    document.getElementById('minDrainInput').addEventListener('change', () => {
      this.coherence.minDrain = Math.max(0, Math.min(1, this._num('minDrainInput')));
    });
    document.getElementById('maxDrainInput').addEventListener('change', () => {
      this.coherence.maxDrain = Math.max(0, Math.min(5, this._num('maxDrainInput')));
    });
    document.getElementById('regenThreshInput').addEventListener('change', () => {
      this.coherence.regenThreshold = Math.max(0, Math.min(1, this._num('regenThreshInput')));
    });
    document.getElementById('regenRateInput').addEventListener('change', () => {
      this.coherence.regenRate = Math.max(0, Math.min(5, this._num('regenRateInput')));
    });

    document.getElementById('applyPotentialBtn').addEventListener('click', () => {
      this.potentialParams.barrierThickness = this._int('barrierThicknessInput');
      this.potentialParams.barrierV = this._num('barrierVInput');
      this.potentialParams.slitHeight = this._int('slitHeightInput');
      this.potentialParams.slitSeparation = this._int('slitSepInput');
      this.potentialParams.slitOffsetY = this._int('slitOffsetInput');
      this.rebuildPotential();
    });

    document.getElementById('applyAbsorbBtn').addEventListener('click', () => {
      this.absorbParams.margin = this._int('absorbMarginInput');
      this.absorbParams.strength = this._num('absorbStrengthInput');
      this.rebuildAbsorb();
    });

    document.getElementById('reseedBtn').addEventListener('click', () => {
      this.seedParams.sigma = this._num('seedSigmaInput');
      this.seedParams.kx = this._num('seedKxInput');
      this.seedParams.ky = this._num('seedKyInput');
      this.reseed();
    });
  }
}

