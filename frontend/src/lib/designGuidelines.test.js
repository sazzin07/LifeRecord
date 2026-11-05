import fs from "fs";
import path from "path";

// design_guidelines.json describes the real app (roadmap D-10). This keeps it from drifting back into a story about one
// person and a palette that no longer exists: it must stay multi-user, and every colour it names must exist in the code.
const root = path.resolve(__dirname, "../../..");
const guidelines = fs.readFileSync(path.join(root, "design_guidelines.json"), "utf8");

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? sourceFiles(p) : /\.(css|js|jsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
});

describe("design_guidelines.json", () => {
  test("is valid JSON and says it is for many people", () => {
    const parsed = JSON.parse(guidelines);
    expect(parsed.users).toMatch(/many people/i);
    expect(guidelines).not.toMatch(/single private user|for Sá|\bSá\b/i);
  });

  test("every colour it names exists in the code", () => {
    const code = sourceFiles(path.join(root, "frontend/src")).map((f) => fs.readFileSync(f, "utf8").toLowerCase()).join("\n");
    const missing = [...new Set(guidelines.match(/#[0-9a-fA-F]{6}\b/g) || [])].filter((hex) => !code.includes(hex.toLowerCase()));
    expect(missing).toEqual([]);
  });

  test("its colour tokens are the ones in index.css", () => {
    const css = fs.readFileSync(path.join(root, "frontend/src/index.css"), "utf8");
    const { colour_tokens_hsl: tokens } = JSON.parse(guidelines);
    for (const [name, value] of Object.entries({ ...tokens.light, ...tokens.dark })) {
      if (name === "radius") continue;
      expect(css).toContain(`--${name}: ${value};`);
    }
  });

  test("it lists every page the dock offers", () => {
    const dock = fs.readFileSync(path.join(root, "frontend/src/components/dock/dockData.js"), "utf8");
    const labels = [...dock.matchAll(/page\("[^"]+", "([^"]+)", "[^"]+"\)|id: "(?:home|settings)", label: "([^"]+)"/g)].map((m) => m[1] || m[2]);
    expect(labels.length).toBe(10);
    expect(JSON.parse(guidelines).layout_and_navigation.pages).toEqual(labels);
  });
});
