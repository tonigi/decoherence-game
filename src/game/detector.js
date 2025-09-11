export class Detector {
  constructor({ x = 290, y = 70, w = 20, h = 40 } = {}) {
    this.x = x; this.y = y; this.w = w; this.h = h;
  }
  contains(px, py) {
    return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
  }
}

