export class CPURenderer {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.imageData = this.ctx.createImageData(width, height);
    this.brightness = 2.5; // scale density → brightness
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.imageData = this.ctx.createImageData(width, height);
  }

  render(density) {
    const { data } = this.imageData;
    let maxD = 0;
    // optional auto-exposure: find max density (cheap approximate)
    for (let i = 0; i < density.length; i += 64) {
      if (density[i] > maxD) maxD = density[i];
    }
    const scale = this.brightness / (maxD + 1e-6);
    for (let i = 0, p = 0; i < density.length; i++, p += 4) {
      const d = Math.min(1.0, density[i] * scale);
      const r = Math.min(255, Math.floor(30 + 220 * d));
      const g = Math.min(255, Math.floor(180 * d));
      const b = Math.min(255, Math.floor(255 * d));
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
