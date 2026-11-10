import { Ease, easeInOut, motion } from "./ease";

const run = (e, ms, dt = 1 / 60) => { for (let t = 0; t < ms / 1000; t += dt) e.step(dt); };

describe("easeInOut (cubic-bezier 0.65, 0, 0.35, 1)", () => {
  it("starts at 0, ends at 1, is monotonic and symmetric about the middle", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 3);
    let prev = 0;
    for (let i = 1; i <= 100; i++) { const y = easeInOut(i / 100); expect(y).toBeGreaterThanOrEqual(prev); prev = y; }
    expect(easeInOut(0.2) + easeInOut(0.8)).toBeCloseTo(1, 2);
  });
  it("eases in and out: slow at both ends", () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });
});

describe("Ease", () => {
  beforeEach(() => { motion.reduce = false; });

  it("takes about its duration to land, and not before", () => {
    const e = new Ease(0, 800); e.t = 10;
    run(e, 700); expect(e.v).toBeLessThan(10);
    run(e, 150); expect(e.v).toBe(10);
  });

  it("is interruptible: a new target starts from where it is, without a jump", () => {
    const e = new Ease(0, 800); e.t = 10;
    run(e, 300);
    const mid = e.v;
    e.t = -5;
    expect(e.v).toBe(mid);                 // nothing jumps when the target changes
    e.step(1 / 60);
    expect(Math.abs(e.v - mid)).toBeLessThan(1);
    run(e, 900); expect(e.v).toBe(-5);
  });

  it("setting the same target does not restart the move", () => {
    const e = new Ease(0, 800); e.t = 10; run(e, 400);
    const v = e.v; e.t = 10; e.step(0); expect(e.v).toBe(v);
  });

  it("a retarget by a hair does not restart the move (a window resize re-aims the camera every tick)", () => {
    const e = new Ease(0, 800); e.t = 10; run(e, 400);
    const v = e.v; e.t = 10.0004; e.step(1 / 60);
    expect(e.v).toBeGreaterThan(v);   // still on its way to 10, not restarted from here
    run(e, 500); expect(e.v).toBe(10);
  });

  it("reduced motion lands at once", () => {
    motion.reduce = true;
    const e = new Ease(0, 800); e.t = 7;
    expect(e.v).toBe(7);
  });

  it("kick starts an intro that flies in to the target", () => {
    const e = new Ease(1, 1000); e.kick(3);
    expect(e.v).toBe(3);
    run(e, 1100); expect(e.v).toBe(1);
  });
});
