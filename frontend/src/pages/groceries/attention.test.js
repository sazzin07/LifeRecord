import { attentionWords, needsYou } from "./attention";

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const food = (over) => ({ name: "Food", quantity: 1, unit: "unit", low_threshold: 0, expiration: null, ...over });

describe("needs you: one meaning for Today and Storage", () => {
  it("counts food in stock that goes off within three days, or already has", () => {
    expect(needsYou(food({ expiration: day(-2) }))).toBe(true);
    expect(needsYou(food({ expiration: day(3) }))).toBe(true);
    expect(needsYou(food({ expiration: day(4) }))).toBe(false);
    expect(needsYou(food({ expiration: null }))).toBe(false);
    expect(needsYou(food({ expiration: day(1), quantity: 0 }))).toBe(false);   // nothing left to save
  });

  it("says it in the page's own words", () => {
    const items = [food({ expiration: day(1) }), food({ expiration: day(-1) }), food({ quantity: 1, low_threshold: 2 })];
    expect(attentionWords(items)).toBe("2 need you · 1 running low");
    expect(attentionWords([food({ expiration: day(2) })])).toBe("1 needs you");
    expect(attentionWords([food({})])).toBe("");
  });
});
