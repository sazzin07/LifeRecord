import { checksFor, strength, suggestPassword } from "./passwordStrength";

describe("password strength", () => {
  test("nothing typed says nothing", () => { expect(strength("")).toEqual({ score: 0, label: "", tip: "" }); });
  test("short is too weak", () => { expect(strength("ab1").label).toBe("Too weak"); });
  test("a common word stays weak however it is dressed", () => { expect(strength("Password123").score).toBeLessThanOrEqual(1); });
  test("a long mixed password is strong", () => { expect(strength("Tr4in-Lamp-Orange-92").score).toBe(4); });
  test("a repeated character does not count as long", () => { expect(strength("aaaaaaaaaaaa1").score).toBeLessThanOrEqual(1); });
  test("the checks follow the server's rules", () => {
    const ids = (pw, ctx) => checksFor(pw, ctx).filter((c) => !c.ok).map((c) => c.id);
    expect(ids("abcdefgh")).toEqual(["number"]);
    expect(ids("12345678")).toEqual(["letter"]);
    expect(ids("Same1234", { current: "Same1234" })).toEqual(["different"]);
    expect(ids("tiago2026x", { email: "tiago@x.com" })).toEqual(["own"]);
  });
  test("a suggestion is long, readable and always passes the rules", () => {
    for (let i = 0; i < 50; i += 1) {
      const p = suggestPassword((n) => Uint32Array.from({ length: n }, () => Math.floor(Math.random() * 4294967296)));   // jsdom has no crypto
      expect(p).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
      expect(checksFor(p).every((c) => c.ok)).toBe(true);
      expect(strength(p).score).toBeGreaterThanOrEqual(3);
    }
  });
});
