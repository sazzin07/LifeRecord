import { RING_LENGTH, freshPercent, ringArcs } from "./ringMath";

const parts = (gone, soon, fresh) => [{ key: "gone", n: gone, color: "red" }, { key: "soon", n: soon, color: "amber" }, { key: "fresh", n: fresh, color: "green" }];
const by = (arcs, key) => arcs.find((a) => a.key === key);

describe("ringArcs", () => {
  it("15 fresh, 0 soon, 6 gone off: exact shares that add up to the whole ring, the empty one draws nothing", () => {
    const a = ringArcs(parts(6, 0, 15), 21);
    expect(by(a, "gone").len).toBeCloseTo((6 / 21) * 100, 2);
    expect(by(a, "fresh").len).toBeCloseTo((15 / 21) * 100, 2);
    expect(by(a, "soon")).toMatchObject({ len: 0, draw: 0 });
    expect(a.reduce((s, x) => s + x.len, 0)).toBeCloseTo(RING_LENGTH, 2);
    expect(by(a, "fresh").start).toBeCloseTo(by(a, "gone").len, 2);   // butt-joined: no gap
  });

  it("each share starts exactly where the one before ends", () => {
    const a = ringArcs(parts(1, 2, 3), 6);
    expect(by(a, "soon").start).toBeCloseTo(by(a, "gone").start + by(a, "gone").len, 2);
    expect(by(a, "fresh").start).toBeCloseTo(by(a, "soon").start + by(a, "soon").len, 2);
  });

  it("all fresh is one full closed circle", () => {
    const a = ringArcs(parts(0, 0, 21), 21);
    expect(by(a, "fresh")).toMatchObject({ start: 0, len: 100, draw: 100 });
    expect(by(a, "gone").draw).toBe(0);
  });

  it("all gone off is one full closed circle", () => {
    expect(by(ringArcs(parts(4, 0, 0), 4), "gone")).toMatchObject({ start: 0, len: 100, draw: 100 });
  });

  it("empty: no shares, no NaN", () => {
    const a = ringArcs(parts(0, 0, 0), 0);
    a.forEach((x) => { expect(x.len).toBe(0); expect(Number.isNaN(x.start)).toBe(false); expect(Number.isNaN(x.draw)).toBe(false); });
  });

  it("a single item is the whole ring", () => {
    expect(by(ringArcs(parts(0, 1, 0), 1), "soon")).toMatchObject({ len: 100, draw: 100 });
  });

  it("with two or more shares, each is pulled in so its rounded ends sit a small gap apart; a lone share stays the whole ring", () => {
    const a = ringArcs(parts(6, 0, 15), 21);
    const g = by(a, "gone"), f = by(a, "fresh");
    expect(g.draw).toBeLessThan(g.len);
    expect(f.drawStart).toBeGreaterThan(g.drawStart + g.draw);          // a clear space between them...
    expect(f.drawStart - (g.drawStart + g.draw)).toBeLessThan(6);        // ...a small one
    expect(by(ringArcs(parts(0, 0, 21), 21), "fresh")).toMatchObject({ drawStart: 0, draw: 100 });
  });

  it("tolerates bad numbers", () => {
    const a = ringArcs([{ key: "a", n: -3, color: "x" }, { key: "b", n: "7", color: "y" }, { key: "c", n: undefined, color: "z" }], 7);
    expect(by(a, "a").len).toBe(0);
    expect(by(a, "b").len).toBe(100);
    expect(by(a, "c").len).toBe(0);
  });
});

describe("freshPercent", () => {
  it("rounds the fresh share to a whole number", () => {
    expect(freshPercent(15, 21)).toBe(71);
    expect(freshPercent(1, 3)).toBe(33);
    expect(freshPercent(2, 3)).toBe(67);
    expect(freshPercent(21, 21)).toBe(100);
    expect(freshPercent(0, 5)).toBe(0);
  });
  it("only says 100 when everything is fresh", () => {
    expect(freshPercent(1999, 2000)).toBe(99);
    expect(freshPercent(2000, 2000)).toBe(100);
    expect(freshPercent(1, 1000)).toBe(0);
  });
  it("is null when there is nothing to measure", () => {
    expect(freshPercent(0, 0)).toBeNull();
    expect(freshPercent(3, 0)).toBeNull();
  });
});
