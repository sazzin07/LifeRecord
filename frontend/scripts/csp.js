/* Content-Security-Policy for the production build (SEC-007).
 *
 * The dev server needs inline scripts and websockets for hot reload, so the policy is only added to `build/`:
 *   craco build && node scripts/csp.js
 * The script puts a <meta http-equiv> tag into build/index.html and writes build/security-headers.txt with the same
 * policy as a response header (plus frame-ancestors, which a <meta> tag cannot carry) for the web server in front.
 */
const fs = require("fs");
const path = require("path");

function buildCsp({ backendUrl }) {
  const backend = new URL(backendUrl).origin;
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React and Radix set style attributes at runtime; Google Fonts supplies the typefaces.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // Photos and chat pictures are shown from blob: URLs after an authenticated fetch.
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self' ${backend}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
  ].join("; ");
}

function injectCsp(html, csp) {
  if (html.includes('http-equiv="Content-Security-Policy"')) return html; // already done
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}" />`;
  const charset = /<meta charset="[^"]*"\s*\/?>/i;
  return charset.test(html) ? html.replace(charset, (m) => `${m}\n    ${tag}`) : html.replace(/<head>/i, `<head>\n    ${tag}`);
}

function headerForm(csp) {
  return `Content-Security-Policy: ${csp}; frame-ancestors 'none'\n`;
}

function main(buildDir = path.join(__dirname, "..", "build")) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  if (!backendUrl) throw new Error("REACT_APP_BACKEND_URL is not set; the policy needs it for connect-src.");
  const csp = buildCsp({ backendUrl });
  const indexPath = path.join(buildDir, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    throw new Error("build/index.html has an inline <script>; set INLINE_RUNTIME_CHUNK=false for the build.");
  }
  fs.writeFileSync(indexPath, injectCsp(html, csp));
  fs.writeFileSync(path.join(buildDir, "security-headers.txt"), headerForm(csp));
  console.log("Content-Security-Policy added to build/index.html (connect-src " + new URL(backendUrl).origin + ")");
}

module.exports = { buildCsp, injectCsp, headerForm };
if (require.main === module) main();
