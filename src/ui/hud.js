export class HUD {
  constructor() {
    this.fillEl = document.getElementById('coherenceFill');
  }
  setCoherence01(val01) {
    const v = Math.max(0, Math.min(1, val01));
    this.fillEl.style.transform = `scaleX(${v})`;
  }
}

