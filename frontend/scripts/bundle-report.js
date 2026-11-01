#!/usr/bin/env node
/* Bundle size report and budget check (roadmap D-07).

     node scripts/bundle-report.js            print the table and write docs/performance/bundle-<date>.json
     node scripts/bundle-report.js --check    also compare with bundle-budget.json; exit 1 if anything is over budget
     node scripts/bundle-report.js --set-budget   write bundle-budget.json from this build (measured size plus 10 %)

   Sizes are what a browser downloads: gzip level 9 of every .js and .css file in build/static. A chunk is listed by its
   role when it can be told (the main bundle, the barcode scanner, a page), otherwise by its file name without the hash.
   The budget is per role, so adding a new lazy page does not need a new entry, but the main bundle and the biggest lazy
   chunks cannot quietly grow. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const staticDir = path.join(root, "build", "static");
const budgetFile = path.join(root, "bundle-budget.json");
const MARGIN = 1.1;

function files(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(js|css)$/.test(e.name) ? [p] : [];
  }) : [];
}

function role(file, source) {
  const name = path.basename(file).replace(/\.[0-9a-f]{8}\./, ".");
  if (/^main\./.test(name)) return name.endsWith(".css") ? "main.css" : "main.js";
  if (/@zxing|BrowserMultiFormatReader/.test(source)) return "scanner (zxing)";
  return null;
}

function measure() {
  const rows = files(staticDir).map((f) => {
    const raw = fs.readFileSync(f);
    return { file: path.basename(f), role: role(f, raw.toString("utf8")), raw: raw.length, gzip: zlib.gzipSync(raw, { level: 9 }).length };
  });
  const named = rows.map((r) => ({ ...r, key: r.role || (r.file.endsWith(".css") ? "css chunk" : "lazy chunk") }));
  const groups = {};
  for (const r of named) (groups[r.key] ||= []).push(r);
  const summary = Object.entries(groups).map(([key, list]) => ({
    key, files: list.length, gzip_total: list.reduce((a, r) => a + r.gzip, 0), gzip_largest: Math.max(...list.map((r) => r.gzip)),
  }));
  return { rows: named.sort((a, b) => b.gzip - a.gzip), summary, total_gzip: rows.reduce((a, r) => a + r.gzip, 0) };
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const result = measure();
if (!result.rows.length) { console.error("No build found: run `yarn build` first."); process.exit(2); }

console.log("\nLargest files (gzip):");
for (const r of result.rows.slice(0, 12)) console.log(`  ${kb(r.gzip).padStart(10)}  ${kb(r.raw).padStart(10)} raw  ${r.key.padEnd(18)} ${r.file}`);
console.log("\nBy role:");
for (const s of result.summary) console.log(`  ${s.key.padEnd(18)} ${String(s.files).padStart(3)} files  total ${kb(s.gzip_total).padStart(10)}  largest ${kb(s.gzip_largest).padStart(10)}`);
console.log(`\nTotal downloaded if every chunk were fetched: ${kb(result.total_gzip)}`);

const date = new Date().toISOString().slice(0, 10);
const outDir = path.resolve(root, "..", "docs", "performance");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `bundle-${date}.json`), JSON.stringify({ date, ...result }, null, 1) + "\n");

if (process.argv.includes("--set-budget")) {
  const budget = {
    note: "Gzip sizes in bytes: the measured size plus 10 %. Raise a number only on purpose, with a reason in the commit.",
    set_on: date,
    total_gzip: Math.ceil(result.total_gzip * MARGIN),
    largest_single_file_gzip: Math.ceil(Math.max(...result.rows.map((r) => r.gzip)) * MARGIN),
    roles: Object.fromEntries(result.summary.map((s) => [s.key, { gzip_largest: Math.ceil(s.gzip_largest * MARGIN) }])),
  };
  fs.writeFileSync(budgetFile, JSON.stringify(budget, null, 1) + "\n");
  console.log(`\nBudget written to ${path.relative(root, budgetFile)}`);
}

if (process.argv.includes("--check")) {
  const budget = JSON.parse(fs.readFileSync(budgetFile, "utf8"));
  const over = [];
  if (result.total_gzip > budget.total_gzip) over.push(`total ${kb(result.total_gzip)} > ${kb(budget.total_gzip)}`);
  const biggest = Math.max(...result.rows.map((r) => r.gzip));
  if (biggest > budget.largest_single_file_gzip) over.push(`largest file ${kb(biggest)} > ${kb(budget.largest_single_file_gzip)}`);
  for (const s of result.summary) {
    const limit = budget.roles[s.key];
    if (!limit) over.push(`new kind of file "${s.key}" has no budget (run --set-budget on purpose)`);
    else if (s.gzip_largest > limit.gzip_largest) over.push(`${s.key}: ${kb(s.gzip_largest)} > ${kb(limit.gzip_largest)}`);
  }
  if (over.length) { console.error(`\nOVER BUDGET:\n  ${over.join("\n  ")}`); process.exit(1); }
  console.log("\nWithin budget.");
}
