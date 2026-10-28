// Coach marks for guided levels. A level's `tutorial` is a list of steps
//   { anchor, title, text, phys?, wait }
// anchor: a UI name resolved by the host (field, play, observe, ring, timeline,
//   physics, result, handle:k, ...); wait: 'next' (a Next button), a game signal
//   ('play', 'observe', 'result', 'drag') or a time condition 't>=8'.
// Each step spotlights its anchor and advances when its wait condition is met,
// so the player learns by doing rather than by clicking through text.
const $ = (id) => document.getElementById(id);
const WAIT_TEXT = { play: 'Waiting for Play', observe: 'Waiting for Observe', result: 'Waiting for the result', drag: 'Waiting for you to drag' };

export class Tutorial {
  /** host: { anchorRect(name) -> DOMRect | null, done(levelId), changed() } */
  constructor(host) {
    this.host = host; this.steps = null; this.i = 0; this.level = null; this.seen = new Set();
    $('coachNext').onclick = () => this.advance();
  }
  get active() { return !!this.steps; }

  start(level) {
    this.level = level; this.steps = level.tutorial; this.i = 0; this.seen = new Set();
    this.show(); this.host.changed();
  }
  stop() {
    this.steps = null; $('coachLayer').hidden = true; this.host.changed();
  }
  advance() {
    if (!this.steps) return;
    if (++this.i >= this.steps.length) { const id = this.level.id; this.stop(); this.host.done(id); return; }
    if (this.satisfied(this.steps[this.i].wait)) { this.advance(); return; }
    this.show(); this.host.changed();
  }
  /** A game event happened. Later events imply earlier ones (observing means you
   *  played), so a step whose wait is already satisfied is skipped. */
  signal(name) {
    if (!this.steps) return;
    this.seen.add(name);
    if (this.satisfied(this.steps[this.i].wait)) this.advance();
  }
  /** The run went back to setup: play / observe / result have to happen again. */
  reset() { this.seen.clear(); }
  satisfied(w) {
    const order = ['play', 'observe', 'result'];
    if (w === 'drag') return this.seen.has('drag');
    if (!order.includes(w)) return false;
    return order.slice(order.indexOf(w)).some(e => this.seen.has(e));
  }
  /** Called every frame with the run clock: time waits, and keeping the spotlight on its anchor. */
  tick(t) {
    if (!this.steps) return;
    const st = this.steps[this.i], m = /^t>=([\d.]+)$/.exec(st.wait || '');
    if (m && t >= +m[1]) { this.advance(); return; }
    this.place();
  }

  show() {
    const st = this.steps[this.i];
    $('coachLayer').hidden = false;
    // steps that ask the player to act on the game dim the page only lightly
    $('coachLayer').classList.toggle('act', st.wait !== 'next');
    $('coachStep').textContent = `${this.level.id} · step ${this.i + 1} of ${this.steps.length}`;
    $('coachTitle').textContent = st.title;
    $('coachText').innerHTML = st.text;
    $('coachPhys').innerHTML = st.phys || '';
    const timed = /^t>=/.test(st.wait || '');
    $('coachWait').textContent = WAIT_TEXT[st.wait] || (timed ? 'Watch…' : '');
    const last = this.i === this.steps.length - 1;
    $('coachNext').hidden = !(st.wait === 'next' || timed);
    $('coachNext').textContent = st.wait === 'next' ? (last ? 'Finish' : 'Next') : 'Skip ahead';
    this.place();
  }

  /** Spotlight the anchor and put the card beside it, inside the viewport. */
  place() {
    const st = this.steps[this.i], spot = $('coachSpot'), card = $('coach');
    const r = this.host.anchorRect(st.anchor), vw = innerWidth, vh = innerHeight, pad = 8;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (!r || r.width === 0) {
      spot.hidden = true;
      card.style.left = Math.max(12, (vw - cw) / 2) + 'px'; card.style.top = Math.max(12, vh - ch - 24) + 'px';
      return;
    }
    spot.hidden = false;
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
    // prefer below or above (keeps the field clear when the anchor is in the rail or the
    // transport bar), then beside; a huge anchor (the field) gets the card beside or inside
    const gap = 16, room = { right: vw - r.right, left: r.left, below: vh - r.bottom, above: r.top };
    const cx = Math.min(r.left, vw - cw - 12);
    let x, y;
    if (room.below >= ch + gap + 12 && r.height < vh * 0.5) { x = cx; y = r.bottom + gap; }
    else if (room.above >= ch + gap + 12 && r.height < vh * 0.5) { x = cx; y = r.top - gap - ch; }
    else if (room.right >= cw + gap + 12) { x = r.right + gap; y = r.top + r.height / 2 - ch / 2; }
    else if (room.left >= cw + gap + 12) { x = r.left - gap - cw; y = r.top + r.height / 2 - ch / 2; }
    else { x = r.left + 24; y = r.bottom - ch - 24; }
    card.style.left = Math.min(vw - cw - 12, Math.max(12, x)) + 'px';
    card.style.top = Math.min(vh - ch - 12, Math.max(12, y)) + 'px';
  }
}
