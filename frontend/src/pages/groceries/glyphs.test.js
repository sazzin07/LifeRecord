import { Glyph } from "./glyphs";

describe("food drawings", () => {
  it.each([
    ["Coffee beans", "Drinks", "coffee"],
    ["Baked beans", "Pantry", "can"],
    ["Green beans", "Vegetables", "peas"],
    ["Free-range eggs", "Eggs", "egg"],
    ["Cheddar", "Dairy", "cheese"],
    ["Oat milk", "Dairy", "milk"],
  ])("%s gets the %s drawing", (name, category, drawing) => {
    expect(Glyph.key(name, category)).toBe(drawing);
  });
});
