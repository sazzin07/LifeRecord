/* An eased, interruptible move between two values: the camera's fly-to. cubic-bezier(0.65, 0, 0.35, 1) over `ms` (about 800).
   Setting a new target mid-flight restarts from wherever the value is now, so input never has to wait and nothing jumps.
   Same surface as the room's springs (v, t, vel, step), so the camera treats both alike. Plain numbers, no 3D library: easy to test. */
export const motion = { reduce: false };   // set by the room from prefers-reduced-motion: moves then land at once

const P1X = 0.65, P2X = 0.35;   // y control points are 0 and 1
export function easeInOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 20; i++) {
    const bx = 3 * (1 - t) * (1 - t) * t * P1X + 3 * (1 - t) * t * t * P2X + t * t * t;
    if (bx < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return 3 * (1 - t) * t * t + t * t * t;
}

export class Ease {
  constructor(v = 0, ms = 800) { this.v = v; this.vel = 0; this.ms = ms; this.a = v; this.b = v; this.e = 1; }
  get t() { return this.b; }
  set t(x) {
    if (Math.abs(x - this.b) < 1e-3) return;   // a resize re-aims the camera by tiny amounts: that must not restart the move each time
    this.a = this.v; this.b = x; this.e = 0;
    if (motion.reduce) { this.v = x; this.e = 1; this.vel = 0; }
  }
  kick(v0) { this.v = v0; this.a = v0; this.e = 0; }   // start from here: an intro that flies in to the target
  step(dt) {
    if (this.e >= 1) { this.v = this.b; this.vel = 0; return; }
    this.e = Math.min(1, this.e + (dt * 1000) / this.ms);
    this.v = this.a + (this.b - this.a) * easeInOut(this.e);
    this.vel = this.e >= 1 ? 0 : 1;
  }
}
