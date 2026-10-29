const { buildCsp, injectCsp, headerForm } = require("../../scripts/csp");

const html = '<!doctype html><html><head><meta charset="utf-8" /><title>x</title></head><body></body></html>';

test("scripts are limited to the app's own files and the API origin is the only extra connect target", () => {
  const csp = buildCsp({ backendUrl: "https://api.example.com/some/path" });
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  expect(csp).toContain("connect-src 'self' https://api.example.com");
  expect(csp).not.toContain("some/path");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-src 'none'");
});

test("the policy goes right after the charset tag, once", () => {
  const csp = buildCsp({ backendUrl: "http://localhost:8000" });
  const once = injectCsp(html, csp);
  expect(once.indexOf("charset")).toBeLessThan(once.indexOf("Content-Security-Policy"));
  expect(once.indexOf("Content-Security-Policy")).toBeLessThan(once.indexOf("<title>"));
  expect(injectCsp(once, csp)).toBe(once);
  expect(once.match(/Content-Security-Policy/g)).toHaveLength(1);
});

test("the header form adds frame-ancestors, which a meta tag cannot carry", () => {
  const header = headerForm(buildCsp({ backendUrl: "http://localhost:8000" }));
  expect(header.startsWith("Content-Security-Policy: ")).toBe(true);
  expect(header).toContain("frame-ancestors 'none'");
});
