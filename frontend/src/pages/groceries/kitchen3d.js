/* The kitchen: a real-time 3D room (three.js), one instance per Storage tab. createKitchen3D() builds it; the page listens with on(name, fn),
   hands it data with sync() and tears it down with dispose(). The page falls back to the flat view when the scene cannot start. */
/* eslint-disable no-mixed-operators */
import { ACESFilmicToneMapping, BoxGeometry, CanvasTexture, CapsuleGeometry, CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, Fog, Group, HemisphereLight, IcosahedronGeometry, LatheGeometry, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, PCFSoftShadowMap, PMREMGenerator, PerspectiveCamera, Plane, PlaneGeometry, PointLight, Raycaster, RepeatWrapping, SRGBColorSpace, Scene, Shape, SphereGeometry, SpotLight, TubeGeometry, VSMShadowMap, Vector2, Vector3, WebGLRenderer } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Glyph } from "./glyphs";

const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (n) => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ---------------------------------------------------------------- springs: every motion is interruptible and keeps its velocity */
class Spring {
  constructor(v = 0, k = 120, c = 16) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.c = c; }
  step(dt) {
    if (REDUCE) { this.v = this.t; this.vel = 0; return; }
    const n = 4, h = dt / n;
    for (let i = 0; i < n; i++) { this.vel += (this.k * (this.t - this.v) - this.c * this.vel) * h; this.v += this.vel * h; }
  }
}

/* ---------------------------------------------------------------- procedural textures */
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new CanvasTexture(c); t.colorSpace = opts.linear ? NoColorSpace : SRGBColorSpace; t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(...opts.repeat); }
  return t;
}
const brushed = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = "#8a8a8a"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const x = Math.random() * w, a = Math.random() * 0.22; g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a * 0.5})` : `rgba(0,0,0,${a * 0.5})`; g.fillRect(x, 0, 1 + Math.random() * 1.4, h); }
}, { linear: true, repeat: [1, 1] });
const woodTex = (base) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    const y = Math.random() * h, a = 0.03 + Math.random() * 0.09; g.strokeStyle = Math.random() > 0.5 ? `rgba(60,30,10,${a})` : `rgba(255,220,170,${a * 0.8})`; g.lineWidth = 0.6 + Math.random() * 2.2;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 14, w * 0.7, y + (Math.random() - 0.5) * 14, w, y + (Math.random() - 0.5) * 6); g.stroke();
  }
}, { repeat: [1, 1] });
const wallTex = () => canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#c9c9c9"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const plankTex = () => { const t = canvasTex(1024, 256, (g, w, h) => {   // greyscale planks: the theme tints them through the material colour
  for (let r = 0; r < 4; r++) {
    const y0 = r * 64, base = 205 + Math.floor(hash(r + 3) * 30); g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, y0, w, 64);
    for (let i = 0; i < 70; i++) { const y = y0 + Math.random() * 64, a = 0.03 + Math.random() * 0.07; g.strokeStyle = Math.random() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`; g.lineWidth = 0.6 + Math.random() * 1.6; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 6, w * 0.7, y + (Math.random() - 0.5) * 6, w, y + (Math.random() - 0.5) * 3); g.stroke(); }
    const bx = hash(r * 9 + 1) * w; g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(bx, y0, 2, 64);
    g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(0, y0, w, 2); g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(0, y0 + 2, w, 1);
  }
}, { repeat: [14, 26] }); return t; };
const contactTex = () => canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });

const CAT = { Meat: "#e0475b", Fish: "#2f9bd6", Eggs: "#e0a02a", Dairy: "#4f7fe6", Carbohydrates: "#e8812f", Fruit: "#d94f93", Vegetables: "#2ea876", Frozen: "#25aab8", Pantry: "#8a63d2", Snacks: "#c04bc9", Drinks: "#1fa59a", Other: "#7a6f86" };
const labelCache = new Map();
function labelTex(name, cat, wide) {
  const key = `${name}|${cat}|${wide ? 1 : 0}`; if (labelCache.has(key)) return labelCache.get(key);
  const col = CAT[cat] || CAT.Other;
  const t = canvasTex(wide ? 1024 : 256, 256, (g, w, h) => {
    const x0 = wide ? w * 0.5 - 128 : 0; // cylinders are wrapped, so the label sits in the middle of the strip
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, shade(col, 0.06)); gr.addColorStop(1, shade(col, -0.24));
    g.fillStyle = col; g.fillRect(0, 0, w, h);
    g.fillStyle = gr; g.fillRect(x0, 0, 256, h);
    // a round sticker with the drawn food, then the name: recognisable from across the room
    g.fillStyle = "#fffaf4"; g.beginPath(); g.arc(x0 + 128, 84, 70, 0, 7); g.fill();
    g.lineWidth = 6; g.strokeStyle = "rgba(255,255,255,.55)"; g.stroke();
    Glyph.draw(g, Glyph.key(name, cat), x0 + 128, 88, 46);
    g.fillStyle = "#fff"; g.textBaseline = "alphabetic"; g.textAlign = "center"; g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 4; g.shadowOffsetY = 1;
    const words = name.split(" "); const lines = []; let cur = ""; g.font = '800 34px "Plus Jakarta Sans", system-ui, sans-serif';
    words.forEach((wd) => { const test = cur ? cur + " " + wd : wd; if (g.measureText(test).width > 214 && cur) { lines.push(cur); cur = wd; } else cur = test; });
    lines.push(cur);
    const ls = lines.slice(0, 2), fsz = ls.length > 1 ? 34 : 38;
    ls.forEach((l, i) => { let fs = fsz; g.font = `800 ${fs}px "Plus Jakarta Sans", system-ui, sans-serif`; while (g.measureText(l).width > 220 && fs > 16) { fs -= 2; g.font = `800 ${fs}px "Plus Jakarta Sans", system-ui, sans-serif`; } g.fillText(l, x0 + 128, (ls.length > 1 ? 196 : 212) + i * 40); });
    g.shadowColor = "transparent";
  });
  if (wide) { t.wrapS = RepeatWrapping; t.offset.x = 0.5; }
  labelCache.set(key, t); return t;
}
function shade(hex, amt) { const c = new Color(hex); c.offsetHSL(0, 0, amt); return "#" + c.getHexString(); }

/* ---------------------------------------------------------------- item (packaging) shapes */
const rbox = (w, h, d, r, mat) => { const m = new Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005)), mat); m.castShadow = m.receiveShadow = true; return m; };
const cyl = (rt, rb, h, mat, seg = 40) => { const m = new Mesh(new CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = m.receiveShadow = true; return m; };
/* Packaging: real silhouettes (lathed bottles, jars and cans, gabled cartons, pillow bags, trays), the label wrapped on only the front, shared materials,
   everything inside a 0.115 m footprint so neighbours never touch. Loose produce is modelled as produce, not as a box. */
const mats = new Map();
const mat = (key, mk) => { let m = mats.get(key); if (!m) { m = mk(); mats.set(key, m); } return m; };
const plain = (color, extra = {}) => mat("p" + color + JSON.stringify(extra), () => new MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, ...extra }));
const labelMat = (g, extra = {}) => mat("l" + g.name + "|" + g.cat + JSON.stringify(extra), () => new MeshPhysicalMaterial({ map: labelTex(g.name, g.cat, false), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.9, ...extra }));
const glassMat = (col) => mat("g" + col, () => new MeshPhysicalMaterial({ color: col, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.86, envMapIntensity: 1.3 }));
const metal = (col) => plain(col, { metalness: 0.85, roughness: 0.28, clearcoat: 0.2 });
const mesh = (geo, m) => { const o = new Mesh(geo, m); o.castShadow = o.receiveShadow = true; return o; };
const lathe = (pts, seg = 40) => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), seg);
const band = (rt, rb, h, m, arc = 2.4) => mesh(new CylinderGeometry(rt + 0.0008, rb + 0.0008, h, 40, 1, true, -arc / 2, arc), m);   // a label wrapped round the front of a round pack
const put = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const boxM = (w, h, d, r, mats6) => mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005)), mats6);   // faces: +x -x +y -y +z(front) -z

const PRODUCE = { apple: "#d6404f", orange: "#f08a24", tomato: "#e0463a", lemon: "#f6e04a" };
const keyOf = (g) => Glyph.key(g.name, g.cat);
function shapeOf(g) {
  const n = g.name.toLowerCase(), k = keyOf(g), u = g.unit;
  if (u === "can") return "can";
  if (u === "jar") return "jar";
  if (u === "tub") return "tub";
  if (u === "pot") return "pot";
  if (/loaf|bread|sourdough/.test(n)) return "loaf";
  if (/egg/.test(n)) return "eggs";
  if (k === "banana") return "bananas";
  if (PRODUCE[k]) return "round";
  if (k === "leaf" && u === "unit") return "head";
  if (u === "block" || k === "butter" || k === "tofu") return "block";
  if (u === "bottle" || k === "bottle") return "bottle";
  if ((g.cat === "Dairy" && u === "L") || k === "milk" || k === "juice") return "carton";
  if (u === "box" || u === "pack") return "box";
  if (g.cat === "Meat" || g.cat === "Fish") return "tray";
  if (g.cat === "Vegetables" || g.cat === "Fruit" || u === "bag" || /peas|rice|spinach/.test(n)) return "bag";
  if (g.cat === "Drinks") return "bottle";
  return "box";
}
const LOOSE = new Set(["bananas", "round", "head"]);

const SHAPES = {
  carton(g, col, L) {
    const w = 0.072, bh = 0.15, side = plain("#f4f0f7"), grp = new Group();
    grp.add(put(boxM(w, bh, w, 0.004, [side, side, side, side, L, plain("#ece6f1")]), 0, bh / 2, 0));
    const sh = new Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, 0.034); sh.closePath();
    const rg = new ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }); rg.translate(0, 0, -w / 2);
    grp.add(put(mesh(rg, side), 0, bh, 0));
    const cap = mesh(new CylinderGeometry(0.011, 0.012, 0.012, 24), plain(col)); cap.rotation.z = -0.76; grp.add(put(cap, 0.014, bh + 0.027, 0));
    return [grp, bh + 0.036];
  },
  bottle(g, col, L) {
    const grp = new Group();
    grp.add(mesh(lathe([[0, 0], [0.031, 0], [0.034, 0.005], [0.034, 0.105], [0.03, 0.128], [0.0165, 0.152], [0.0145, 0.158], [0.0145, 0.178], [0, 0.178]]), glassMat(shade(col, 0.1))));
    grp.add(put(band(0.034, 0.034, 0.078, L, 2.5), 0, 0.06, 0));
    grp.add(put(mesh(new CylinderGeometry(0.0165, 0.0165, 0.016, 28), plain("#2a1433", { metalness: 0.4 })), 0, 0.186, 0));
    return [grp, 0.194];
  },
  can(g, col, L) {
    const grp = new Group(), m = metal("#c9ccd2");
    grp.add(mesh(lathe([[0, 0], [0.03, 0], [0.032, 0.003], [0.032, 0.1], [0.03, 0.103], [0, 0.103]]), m));
    grp.add(put(band(0.032, 0.032, 0.08, L, 6.283), 0, 0.052, 0));
    grp.add(put(mesh(new CylinderGeometry(0.0265, 0.0265, 0.002, 32), metal("#e4e6ea")), 0, 0.104, 0));
    return [grp, 0.105];
  },
  jar(g, col, L) {
    const grp = new Group();
    grp.add(mesh(lathe([[0, 0], [0.033, 0], [0.035, 0.004], [0.035, 0.078], [0.032, 0.086], [0.03, 0.088], [0, 0.088]]), glassMat("#e8f4f0")));
    grp.add(put(mesh(new CylinderGeometry(0.031, 0.031, 0.072, 32), plain(shade(col, -0.05), { roughness: 0.4 })), 0, 0.04, 0));
    grp.add(put(band(0.035, 0.035, 0.058, L, 2.5), 0, 0.044, 0));
    grp.add(put(mesh(new CylinderGeometry(0.0335, 0.0335, 0.016, 32), metal("#c9a14a")), 0, 0.096, 0));
    return [grp, 0.104];
  },
  tub(g, col, L, s = 1) {
    const grp = new Group();
    grp.add(mesh(lathe([[0, 0], [0.036 * s, 0], [0.0455 * s, 0.076 * s], [0, 0.076 * s]]), plain(shade(col, 0.35), { roughness: 0.45 })));
    grp.add(put(band(0.0452 * s, 0.0378 * s, 0.056 * s, L, 2.7), 0, 0.04 * s, 0));
    grp.add(put(mesh(new CylinderGeometry(0.0472 * s, 0.0472 * s, 0.012, 32), plain("#f4f0f7")), 0, 0.082 * s, 0));
    return [grp, 0.09 * s];
  },
  pot(g, col, L) {
    const grp = SHAPES.tub(g, col, L, 0.82)[0]; grp.add(put(mesh(new CylinderGeometry(0.0385, 0.0385, 0.003, 32), metal("#e9e6ee")), 0, 0.0765, 0)); return [grp, 0.075];
  },
  tray(g, col, L) {
    const grp = new Group(), meat = g.cat === "Fish" ? "#f0a0a6" : "#b83a46";
    grp.add(put(boxM(0.105, 0.02, 0.08, 0.004, plain("#f4f1f7", { roughness: 0.6 })), 0, 0.01, 0));
    grp.add(put(boxM(0.096, 0.014, 0.07, 0.006, plain(meat, { roughness: 0.35, clearcoat: 0.6 })), 0, 0.02, 0));
    grp.add(put(boxM(0.105, 0.005, 0.08, 0.002, mat("film", () => new MeshPhysicalMaterial({ color: "#ffffff", transparent: true, opacity: 0.24, roughness: 0.05, clearcoat: 1, depthWrite: false }))), 0, 0.03, 0));
    const t = plain(shade(CAT[g.cat] || CAT.Other, 0.0)); grp.add(put(boxM(0.06, 0.003, 0.05, 0.001, [t, t, L, t, t, t]), 0, 0.033, 0));
    return [grp, 0.036];
  },
  bag(g, col, L) {
    const grp = new Group(), W = 0.1, H = 0.14, prof = (x, y) => 0.021 * Math.pow(Math.max(0, 1 - (y / (H / 2)) ** 2), 0.55) * (1 - 0.35 * (x / (W / 2)) ** 2) + 0.002;
    const geo = new BoxGeometry(W, H, 0.04, 8, 12, 4), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setZ(i, Math.sign(z) * prof(p.getX(i), p.getY(i)) * (Math.abs(z) / 0.02)); }
    geo.computeVertexNormals(); grp.add(put(mesh(geo, plain(shade(col, 0.08), { roughness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.45 })), 0, 0.077, 0));
    const lg = new PlaneGeometry(0.072, 0.072, 8, 8), lp = lg.attributes.position;   // the label follows the bulge of the bag
    for (let i = 0; i < lp.count; i++) lp.setZ(i, prof(lp.getX(i), lp.getY(i)) + 0.0012); lg.computeVertexNormals();
    grp.add(put(mesh(lg, L), 0, 0.079, 0));
    const crimp = plain(shade(col, -0.18)); [0.003, 0.151].forEach((y) => grp.add(put(boxM(W, 0.012, 0.008, 0.003, crimp), 0, y, 0)));
    return [grp, 0.157];
  },
  eggs(g, col, L) {
    const grp = new Group(), c = plain("#e2d3b3", { roughness: 0.85, clearcoat: 0 });
    grp.add(put(boxM(0.1, 0.034, 0.075, 0.008, c), 0, 0.017, 0));
    grp.add(put(boxM(0.1, 0.03, 0.075, 0.012, [c, c, L, c, plain(shade(col, -0.1)), c]), 0, 0.05, 0));
    return [grp, 0.066];
  },
  loaf(g) {
    const grp = new Group(), crust = plain("#b9773a", { roughness: 0.8, clearcoat: 0.05 });
    grp.add(put(boxM(0.116, 0.07, 0.065, 0.03, crust), 0, 0.035, 0));
    [-1, 0, 1].forEach((i) => { const sc = boxM(0.012, 0.004, 0.034, 0.002, plain("#ecc88f", { roughness: 0.9, clearcoat: 0 })); sc.rotation.y = 0.5; grp.add(put(sc, i * 0.034, 0.069, 0)); });
    return [grp, 0.074];
  },
  block(g, col, L) {
    const grp = new Group(), f = metal("#e8e4ec"), c = plain(shade(col, 0.3));
    grp.add(put(boxM(0.09, 0.034, 0.055, 0.004, [f, f, L, f, c, f]), 0, 0.017, 0)); return [grp, 0.034];
  },
  box(g, col, L) {
    const grp = new Group(), s = plain(shade(col, -0.14)), t = plain(shade(col, 0.1)), b = plain(shade(col, -0.22));
    grp.add(put(boxM(0.088, 0.128, 0.052, 0.005, [s, s, t, b, L, s]), 0, 0.064, 0));
    grp.add(put(boxM(0.0885, 0.004, 0.0525, 0.001, plain(shade(col, -0.3))), 0, 0.118, 0));   // the top flap seam
    return [grp, 0.128];
  },
  bananas(g) {
    const grp = new Group(), y = plain("#f4cf45", { roughness: 0.6, clearcoat: 0.15 }), brown = plain("#6b4a2a", { roughness: 0.8 });
    const curve = new CatmullRomCurve3([new Vector3(-0.055, 0.012, 0), new Vector3(-0.025, -0.002, 0), new Vector3(0.02, -0.002, 0), new Vector3(0.055, 0.014, 0), new Vector3(0.062, 0.03, 0)]);
    const tg = new TubeGeometry(curve, 24, 0.0125, 10, false);
    [[0.017, -0.02, 0.12], [0.017, 0.02, -0.1], [0.04, 0, 0.02]].forEach(([yy, zz, r]) => {
      const b = new Group(); b.add(mesh(tg, y)); b.add(put(mesh(new SphereGeometry(0.0085, 12, 10), brown), -0.056, 0.013, 0)); b.add(put(mesh(new SphereGeometry(0.007, 12, 10), brown), 0.063, 0.032, 0));
      b.position.set(0, yy, zz); b.rotation.y = r; grp.add(b);
    });
    return [grp, 0.07];
  },
  round(g) {
    const grp = new Group(), k = keyOf(g), col = PRODUCE[k], sk = plain(col, { roughness: 0.4, clearcoat: 0.5 }), r = k === "lemon" ? 0.026 : 0.031;
    const n = g.unit === "kg" || g.unit === "g" ? 3 : clamp(Math.ceil(g.qty), 1, 3), spots = [[-0.03, r, 0.012], [0.03, r, 0.01], [0, r * 2.3, -0.004]];
    for (let i = 0; i < n; i++) {
      const s = mesh(new SphereGeometry(r, 24, 18), sk); s.scale.set(1, k === "lemon" ? 0.82 : 0.92, k === "lemon" ? 1.12 : 1); grp.add(put(s, ...spots[i]));
      if (k !== "lemon" && k !== "orange") grp.add(put(mesh(new CylinderGeometry(0.0025, 0.0025, 0.012, 8), plain("#4a6a2a")), spots[i][0], spots[i][1] + r * 0.9, spots[i][2]));
    }
    return [grp, n === 3 ? r * 3.2 : r * 1.9];
  },
  head(g) {
    const grp = new Group(), geo = new IcosahedronGeometry(0.05, 3), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.12 * Math.sin(x * 140 + z * 60) * Math.cos(y * 110); p.setXYZ(i, x * k, y * k * 0.88, z * k); }
    geo.computeVertexNormals(); grp.add(put(mesh(geo, plain("#5fbf6f", { roughness: 0.7, clearcoat: 0.1 })), 0, 0.044, 0));
    return [grp, 0.09];
  },
};
function buildItem(g) {
  const shape = shapeOf(g), col = CAT[g.cat] || CAT.Other, L = labelMat(g);
  const [grp, h] = (SHAPES[shape] || SHAPES.box)(g, col, L);
  const holder = new Group(); holder.scale.setScalar(IS); while (grp.children.length) holder.add(grp.children[0]); grp.add(holder);
  grp.userData.h = h * IS; grp.userData.loose = LOOSE.has(shape); grp.traverse((o) => { if (o.isMesh) o.userData.itemId = g.id; });
  return grp;
}
const copiesOf = (g) => (LOOSE.has(shapeOf(g)) ? 1 : g.unit === "g" || g.unit === "ml" ? clamp(Math.ceil(g.qty / 400), 1, 3) : g.unit === "kg" || g.unit === "L" ? (g.qty >= 1 ? 2 : 1) : clamp(Math.ceil(g.qty), 1, 3));

/* ---------------------------------------------------------------- appliances */
const KINDS = {
  fridge:   { w: 0.7, h: 1.78, d: 0.68, door: "l" },
  freezer:  { w: 0.7, h: 1.05, d: 0.66, door: "drawers" },
  pantry:   { w: 1.0, h: 1.95, d: 0.45, door: "lr" },
  cupboard: { w: 0.8, h: 0.9, d: 0.55, door: "lr" },
  counter:  { w: 1.3, h: 0.9, d: 0.6, door: "none" },
};
const PX = 0.15, PZ = 0.16, IS = 1.2;   // item pitch along the shelf and into its depth
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    brushed: brushed(),
    glass: new MeshPhysicalMaterial({ color: "#dff2ff", roughness: 0.06, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.6, clearcoat: 1, side: DoubleSide }),
    chrome: new MeshStandardMaterial({ color: "#e9e6ee", metalness: 1, roughness: 0.18 }),
    rubber: new MeshStandardMaterial({ color: "#2a2430", roughness: 0.8 }),
    plasticClear: new MeshStandardMaterial({ color: "#d9eef7", roughness: 0.2, transparent: true, opacity: 0.38, depthWrite: false, envMapIntensity: 1.2 }),
    veg: new MeshPhysicalMaterial({ color: "#cfe9d6", roughness: 0.15, transparent: true, opacity: 0.4, clearcoat: 1 }),
    stone: new MeshPhysicalMaterial({ color: "#ece7f1", roughness: 0.28, clearcoat: 0.5, envMapIntensity: 0.9 }),
    wood: {},
  };
  return SHARED;
}
function woodMat(base) { const S = shared(); return (S.wood[base] ||= new MeshStandardMaterial({ map: woodTex(base), roughness: 0.6, envMapIntensity: 0.5 })); }

function buildUnit(def) {
  const K = KINDS[def.kind] || KINDS.cupboard; const S = shared();
  const { w, h, d } = K; const t = 0.036; const U = { id: def.id, kind: def.kind, name: def.name, w, h, d, group: new Group(), doors: [], drawers: [], levels: [], hitMeshes: [], ov: 0, pv: 0, xr: 0, xmeshes: [], exclusive: def.kind === "freezer", alwaysOpen: def.kind === "counter", bump: new Spring(0, 220, 14), hl: new Spring(0, 160, 20), count: 0, items: [] };
  const g = U.group; const lift = def.kind === "fridge" || def.kind === "freezer" ? 0.05 : def.kind === "pantry" ? 0.04 : 0.1;
  const woody = def.kind === "pantry";
  const shellBase = { fridge: "#e2dde9", freezer: "#d3e1ea", pantry: "#b98557", cupboard: "#7e6a96", counter: "#76628f" }[def.kind];
  const shell = woody ? new MeshStandardMaterial({ map: woodTex(shellBase), roughness: 0.55, envMapIntensity: 0.5 })
    : def.kind === "fridge" || def.kind === "freezer" ? new MeshPhysicalMaterial({ color: shellBase, metalness: 0.7, roughness: 0.5, roughnessMap: S.brushed, bumpMap: S.brushed, bumpScale: 0.08, envMapIntensity: 1.7, clearcoat: 0.3, clearcoatRoughness: 0.4 })
      : new MeshPhysicalMaterial({ color: shellBase, roughness: 0.45, clearcoat: 0.45, clearcoatRoughness: 0.35, envMapIntensity: 0.8 });
  const liner = new MeshStandardMaterial({ color: def.kind === "pantry" ? "#e4cfa9" : def.kind === "freezer" ? "#dcebf2" : "#ebe6f1", roughness: 0.55, emissive: "#fff3e6", emissiveIntensity: 0 });
  U.shell = shell; U.liner = liner;
  const xm = (m) => { const c = m.clone(); c.transparent = true; return c; };
  U.xmats = [xm(shell), xm(woodMat("#d8a974")), xm(liner)];   // door skin, pantry door panel, fridge door lining: these fade when the unit is selected
  const add = (m, x, y, z, parent = g) => { m.position.set(x, y, z); parent.add(m); return m; };
  const closedBody = def.kind === "counter";

  // carcass: outer skin + inner liner on every wall
  const bodyH = h - lift;
  add(rbox(t * 0.62, bodyH, d, 0.006, shell), -w / 2 + t * 0.31, lift + bodyH / 2, 0);
  add(rbox(t * 0.62, bodyH, d, 0.006, shell), w / 2 - t * 0.31, lift + bodyH / 2, 0);
  add(rbox(w, t * 0.62, d, 0.006, shell), 0, h - t * 0.31, 0);
  add(rbox(w - 0.004, bodyH, t * 0.5, 0.004, shell), 0, lift + bodyH / 2, -d / 2 + t * 0.25);
  add(rbox(t * 0.4, bodyH - t, d - t * 0.5, 0.003, liner), -w / 2 + t * 0.82, lift + bodyH / 2, t * 0.12);
  add(rbox(t * 0.4, bodyH - t, d - t * 0.5, 0.003, liner), w / 2 - t * 0.82, lift + bodyH / 2, t * 0.12);
  add(rbox(w - t * 1.4, t * 0.4, d - t * 0.5, 0.003, liner), 0, h - t * 0.82, t * 0.12);
  add(rbox(w - t * 1.4, bodyH - t, t * 0.35, 0.003, liner), 0, lift + bodyH / 2, -d / 2 + t * 0.7);
  add(rbox(w - 0.004, t * 0.9, d, 0.006, shell), 0, lift + t * 0.45, 0);   // floor of the cabinet
  if (lift > 0.02) { add(rbox(w - 0.05, lift, d - 0.07, 0.004, S.rubber), 0, lift / 2, -0.01); } // kick plate
  const innerW = w - t * 2.2, innerBottom = lift + t * 0.9;
  const frontZ = d / 2;

  const levelsAt = (ys, parent = g) => ys.forEach((y) => U.levels.push({ y, parent, w: innerW, d: d - t - 0.06 }));
  const shelfPlate = (y, mat, thick = 0.009) => { const p = rbox(innerW - 0.006, thick, d - t - 0.04, 0.002, mat); add(p, 0, y - thick / 2, -0.012); if (mat === S.glass) { const edge = rbox(innerW - 0.006, 0.014, 0.012, 0.004, S.chrome); add(edge, 0, y - 0.006, frontZ - 0.034); } return p; };

  if (def.kind === "fridge") {
    // crisper bins low down, then three glass shelves
    [-1, 1].forEach((s) => { const bin = rbox(innerW / 2 - 0.016, 0.2, d - t - 0.12, 0.012, S.veg); add(bin, s * (innerW / 4), innerBottom + 0.115, -0.03); });
    const ys = [innerBottom + 0.45, innerBottom + 0.86, innerBottom + 1.25];
    shelfPlate(innerBottom + 0.225, S.glass);
    ys.forEach((y) => shelfPlate(y, S.glass));
    levelsAt([innerBottom + 0.229, ...ys.map((y) => y + 0.002)]);
    const strip = rbox(innerW * 0.7, 0.012, 0.03, 0.006, new MeshStandardMaterial({ color: "#fff", emissive: "#fff6ea", emissiveIntensity: 1.5 })); add(strip, 0, h - t - 0.012, frontZ - 0.1); U.strip = strip.material;
  } else if (def.kind === "pantry") {
    const ys = [0.34, 0.8, 1.22, 1.6].map((y) => y + lift);
    ys.forEach((y) => shelfPlate(y, woodMat("#c99863"), 0.022)); levelsAt(ys.map((y) => y + 0.002));
  } else if (def.kind === "cupboard") {
    const y = lift + 0.4; shelfPlate(y, woodMat("#e8dccb"), 0.02); levelsAt([lift + 0.016, y + 0.002]);
  } else if (def.kind === "counter") {
    // the worktop is the shelf; a run of drawer fronts below
    levelsAt([h + 0.044]);
    [0, 1, 2].forEach((i) => {   // three real drawers under the worktop: front, handle, and a tray that slides out with it
      const dg = new Group(); g.add(dg); const cw = w / 3 - 0.02, cx = (i - 1) * (w / 3), ch = bodyH - 0.1, cy = lift + bodyH / 2, hy = cy + ch / 2 - 0.1;
      const fm = U.xmats[0].clone(), fr = rbox(cw, ch, 0.03, 0.01, fm); add(fr, cx, cy, frontZ + 0.012, dg);
      const hd = rbox(cw * 0.55, 0.018, 0.024, 0.008, S.chrome); hd.userData.hnd = true; add(hd, cx, hy, frontZ + 0.04, dg);
      const pr = new Mesh(new BoxGeometry(cw * 0.9, 0.09, 0.07), new MeshBasicMaterial({ visible: false })); pr.userData.prox = true; add(pr, cx, hy, frontZ + 0.04, dg);
      const tw = cw - 0.05, td = d - 0.16, th = ch - 0.16, ty = lift + 0.08;
      add(rbox(tw, 0.01, td, 0.003, liner), cx, ty, -0.04, dg);
      [-1, 1].forEach((sd) => add(rbox(0.01, th, td, 0.003, liner), cx + sd * (tw / 2), ty + th / 2, -0.04, dg));
      add(rbox(tw, th, 0.01, 0.003, liner), cx, ty + th / 2, -0.04 - td / 2, dg);
      U.drawers.push({ g: dg, slide: new Spring(0, 90, 17), i, want: 0, fmat: fm, fmesh: fr });
    });
  }
  if (def.kind === "cupboard" || def.kind === "counter") {
    const top = rbox(w + 0.04, 0.045, d + 0.03, 0.01, S.stone); add(top, 0, h + 0.0225, 0.01);
  }

  // drawers (freezer)
  if (def.kind === "freezer") {
    const dh = (h - lift - t * 1.4) / 3; U.drawerLevels = [];
    for (let i = 2; i >= 0; i--) {   // top drawer first, so the first things you own are the ones you can see
      const dg = new Group(); g.add(dg); const yb = lift + t * 0.9 + i * dh;
      const fm = U.xmats[0].clone(); const front = rbox(w - 0.012, dh - 0.012, 0.04, 0.012, fm); add(front, 0, yb + dh / 2, frontZ - 0.01, dg);
      const hdl = rbox(w * 0.62, 0.02, 0.026, 0.01, S.chrome); add(hdl, 0, yb + dh - 0.06, frontZ + 0.028, dg); hdl.userData.hnd = true;
      const pr = new Mesh(new BoxGeometry(w * 0.8, 0.09, 0.07), new MeshBasicMaterial({ visible: false })); pr.userData.prox = true; add(pr, 0, yb + dh - 0.06, frontZ + 0.03, dg);
      const bw = innerW - 0.03, bd = d - t - 0.1; const base = rbox(bw, 0.008, bd, 0.003, S.plasticClear); add(base, 0, yb + 0.02, -0.02, dg);
      [[-1, 0], [1, 0]].forEach(([s]) => add(rbox(0.006, dh - 0.07, bd, 0.003, S.plasticClear), s * (bw / 2), yb + 0.02 + (dh - 0.07) / 2, -0.02, dg));
      add(rbox(bw, dh - 0.07, 0.006, 0.003, S.plasticClear), 0, yb + 0.02 + (dh - 0.07) / 2, -0.02 - bd / 2, dg);
      add(rbox(bw, dh - 0.07, 0.006, 0.003, S.plasticClear), 0, yb + 0.02 + (dh - 0.07) / 2, -0.02 + bd / 2 - 0.02, dg);
      const dro = { g: dg, slide: new Spring(0, 90, 17), i, want: 0, fmat: fm, fmesh: front };
      U.levels.push({ y: yb + 0.026, parent: dg, w: bw - 0.02, d: bd - 0.06, zc: -0.03, dr: dro });
      U.drawers.push(dro);
    }
  }

  // doors
  const doorMat = U.xmats[0];
  const mkDoor = (dw, side, handle) => {
    const piv = new Group(); const dh = h - lift - 0.012; const mesh = new Group();
    { const slab = rbox(dw - 0.008, dh, 0.045, 0.012, doorMat); slab.position.z = 0.0225; mesh.add(slab); }
    const sgn = side === "l" ? 1 : -1;
    if (woody || def.kind === "cupboard") { const inset = rbox(dw - 0.14, dh - 0.16, 0.012, 0.006, def.kind === "pantry" ? U.xmats[1] : U.xmats[0]); inset.position.z = 0.05; mesh.add(inset); }
    if (handle === "bar") { const bar = new Mesh(new CapsuleGeometry(0.011, 0.5, 6, 14), S.chrome); bar.castShadow = true; bar.userData.hnd = true; bar.position.set(sgn * (dw / 2 - 0.07), dh * 0.05, 0.075); mesh.add(bar); [-0.2, 0.2].forEach((y) => { const post = cyl(0.007, 0.007, 0.05, S.chrome, 12); post.rotation.x = Math.PI / 2; post.position.set(sgn * (dw / 2 - 0.07), dh * 0.05 + y, 0.05); mesh.add(post); }); }
    if (handle === "knob") { const kn = cyl(0.016, 0.016, 0.03, S.chrome, 24); kn.rotation.x = Math.PI / 2; kn.position.set(sgn * (dw / 2 - 0.06), 0, 0.07); kn.userData.hnd = true; mesh.add(kn); }
    if (handle) { const tall = handle === "bar"; const pr = new Mesh(new BoxGeometry(0.2, tall ? Math.min(dh * 0.62, 0.85) : 0.26, 0.16), new MeshBasicMaterial({ visible: false })); pr.position.set(sgn * (dw / 2 - (tall ? 0.07 : 0.06)), tall ? dh * 0.05 : 0, 0.08); pr.userData.prox = true; mesh.add(pr); }   // a generous invisible grab zone round every handle
    if (def.kind === "fridge") {   // clear bins on the inside of the door
      [0.3, 0.1, -0.1, -0.3].forEach((fy) => { const bin = rbox(dw - 0.14, 0.022, 0.07, 0.008, S.plasticClear); bin.position.set(0, dh * fy, -0.035); mesh.add(bin); const lip = rbox(dw - 0.14, 0.05, 0.008, 0.004, S.plasticClear); lip.position.set(0, dh * fy + 0.02, -0.068); mesh.add(lip); });
      const panel = rbox(dw - 0.05, dh - 0.05, 0.008, 0.01, U.xmats[2]); panel.position.z = -0.002; mesh.add(panel);
      [[0, (dh - 0.04) / 2, dw - 0.04, 0.014], [0, -(dh - 0.04) / 2, dw - 0.04, 0.014], [-(dw - 0.04) / 2, 0, 0.014, dh - 0.04], [(dw - 0.04) / 2, 0, 0.014, dh - 0.04]].forEach(([x, y, ww, hh]) => { const st = rbox(ww, hh, 0.014, 0.005, S.rubber); st.position.set(x, y, -0.004); mesh.add(st); });
    }
    mesh.position.set(side === "l" ? dw / 2 : -dw / 2, 0, 0); piv.add(mesh); return piv;
  };
  const mountDoor = (dw, side, handle, max) => { const p = mkDoor(dw, side, handle); p.position.set(side === "l" ? -w / 2 + 0.004 : w / 2 - 0.004, lift + (h - lift) / 2, frontZ); g.add(p); U.doors.push({ p, side, max, s: new Spring(0, 62, 13.5), want: 0 }); };
  if (K.door === "l") mountDoor(w, "l", "bar", 1.7);
  if (K.door === "lr") { mountDoor(w / 2, "l", "knob", 1.7); mountDoor(w / 2, "r", "knob", 1.7); }

  U.proxies = [];
  const tagPart = (d, root) => { d.hot = []; d.hv = 0; root.traverse((o) => { o.userData.partRef = d; if (o.userData.prox) U.proxies.push(o); if (o.userData.hnd) { o.material = o.material.clone(); d.hot.push(o); } }); };   // each door and drawer can be grabbed on its own, handles first
  U.doors.forEach((d) => tagPart(d, d.p)); U.drawers.forEach((d) => tagPart(d, d.g));
  g.traverse((o) => { if (o.isMesh && U.xmats.includes(o.material)) U.xmeshes.push(o); });
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.userData.unitId = def.id; U.hitMeshes.push(o); } });
  // soft contact shadow under the unit
  const contact = new Mesh(new PlaneGeometry(w * 1.5, d * 1.6), new MeshBasicMaterial({ map: contactTex(), transparent: true, depthWrite: false, opacity: 0.8 }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.002; g.add(contact);
  U.itemsRoot = new Group(); g.add(U.itemsRoot);
  U.light = new PointLight("#fff3e6", 0, 1.8, 2); U.light.position.set(0, lift + (h - lift) * 0.82, frontZ - 0.18); g.add(U.light);
  U.capacity = (() => { let n = 0; U.levels.forEach((L) => { const cols = Math.max(1, Math.floor((L.w - 0.02) / PX)); const rows = Math.max(1, Math.floor((L.d - 0.05) / PZ)); n += cols * rows; }); return n; })();
  return U;
}
function slotPositions(U) {
  const out = [];
  U.levels.forEach((L, li) => {
    const cols = Math.max(1, Math.floor((L.w - 0.02) / PX)); const rows = Math.max(1, Math.floor((L.d - 0.05) / PZ));
    const z0 = (L.zc ?? -0.012) + L.d / 2 - 0.07;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ level: li, order: (L.zc !== undefined ? rows - 1 - r : r) * 100 + c, pos: new Vector3((c - (cols - 1) / 2) * PX, L.y, z0 - r * PZ), parent: L.parent, dr: L.dr });
  });
  // fill the front row of every shelf first, so the urgent things are the ones in reach
  return out.sort((a, b) => (Math.floor(a.order / 100) - Math.floor(b.order / 100)) || (a.level - b.level) || (a.order % 100 - b.order % 100));
}

/* ---------------------------------------------------------------- the room */
export function createKitchen3D() {
  let renderer, scene, camera, env, key, rim, hemi, spot, wall, floor, hostEl = null, ro, raf = 0, last = 0;
  let units = [], openId = null, theme = "light", state = null, labelsEl;
  let elBase = 0.07;
  const cam = { fx: new Spring(0, 48, 14), fy: new Spring(0.9, 48, 14), dist: new Spring(4, 48, 14), az: new Spring(0, 60, 15.5), el: new Spring(0.07, 60, 15.5), zoom: new Spring(0, 90, 19), userAz: 0, userEl: 0, zoomT: 0, vAz: 0, vEl: 0 };
  const AZ = 0.95, EL0 = -0.34, EL1 = 0.5, ZMIN = -0.5, ZMAX = 0.35;   // how far you can look round, up and down, and dolly in or out
  const keys = new Set(), ptrs = new Map(); let pinch = null, lastEmpty = 0;
  let backTimer = 0, wheelLock = 0, parX = 0, parY = 0;   // parX and parY: the very slight pointer parallax
  let panTX = 0, panTY = 0, panning = null, carry = null, overview = false, xray = true;   // pan target, a pan in progress, the food you are holding
  const panS = { x: new Spring(0, 80, 18), y: new Spring(0, 80, 18) }, carryPlane = new Plane(new Vector3(0, 0, 1), -0.62);
  const resetView = () => { cam.userAz = 0; cam.userEl = 0; cam.zoomT = 0; cam.vAz = 0; cam.vEl = 0; panTX = 0; panTY = 0; };
  const px = { x: 0, y: 0, nx: 0, ny: 0, inside: false, moved: false };
  const nodes = new Map(); // item id -> { grp[], unit, ... }
  const flights = [];
  let lite = false, slowFrames = 0, goodFrames = 0, probeN = 0; const probe = [];
  function degrade() {
    if (lite) return; lite = true; renderer.setPixelRatio(1); resize();
    renderer.shadowMap.type = PCFSoftShadowMap; renderer.shadowMap.needsUpdate = true;
    [key, spot].forEach((l) => { l.shadow.mapSize.set(l === key ? 1024 : 512, l === key ? 1024 : 512); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } });
    scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
  }
  let hoverId = null, selId = null, dragging = null, pending = null, orbit = null, dropHover = null;
  const ray = new Raycaster(); const v3 = new Vector3();
  let disposed = false; const offs = [], handlers = {};
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
  const emit = (name, detail) => { const h = handlers[name]; if (h && !disposed) h(detail); };

  function init() {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; renderer.shadowMap.type = VSMShadowMap;
    const el = renderer.domElement; el.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;outline:none"; el.setAttribute("aria-hidden", "true");
    scene = new Scene();
    const pm = new PMREMGenerator(renderer); env = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = env; pm.dispose();
    camera = new PerspectiveCamera(28, 1, 0.1, 120);
    hemi = new HemisphereLight("#ffffff", "#c9b8d6", 0.7); scene.add(hemi);
    key = new DirectionalLight("#fff4e8", 2.2); key.position.set(2.6, 4.2, 3.4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -4.5, right: 4.5, top: 3.2, bottom: -1.2, near: 0.5, far: 14 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 7; key.shadow.blurSamples = 16; scene.add(key, key.target);
    rim = new DirectionalLight("#c9a0e6", 0.0); rim.position.set(-3, 2.4, -2.5); scene.add(rim);
    spot = new SpotLight("#fff3e6", 0, 3, 1.0, 0.9, 2); spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005; spot.shadow.normalBias = 0.015; spot.shadow.radius = 5; spot.shadow.blurSamples = 12; scene.add(spot, spot.target);
    wall = new Mesh(new PlaneGeometry(30, 7), new MeshStandardMaterial({ map: wallTex(), roughness: 0.95, envMapIntensity: 0.3 })); wall.position.set(0, 3.2, -0.62); wall.receiveShadow = true; scene.add(wall);
    floor = new Mesh(new PlaneGeometry(40, 20), new MeshStandardMaterial({ map: plankTex(), roughness: 0.42, metalness: 0, envMapIntensity: 0.55 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const skirt = new Mesh(new BoxGeometry(30, 0.11, 0.025), new MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 })); skirt.position.set(0, 0.055, -0.605); scene.add(skirt); scene.userData.skirt = skirt;
    labelsEl = document.createElement("div"); labelsEl.className = "gt-k3d-labels";
    el.addEventListener("pointermove", onMove); el.addEventListener("pointerleave", () => { px.inside = false; setHover(null); });
    el.addEventListener("pointerdown", onDown); el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    el.addEventListener("webglcontextlost", (ev) => { ev.preventDefault(); emit("failed", {}); });
    listen(window, "pointerup", onUp); listen(window, "pointercancel", onCancel); bindKeys();
    ro = new ResizeObserver(resize);
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }

  function setTheme(th) {
    theme = th; shadowDirty = true; if (!renderer) return; const dark = th === "dark";
    const wallC = dark ? "#2a2032" : "#f3edf6", floorC = dark ? "#1a1320" : "#dccfe6";
    wall.material.color.set(wallC); floor.material.color.set(floorC); scene.background = new Color(wallC);
    scene.fog = new Fog(dark ? "#130e17" : "#e7ddee", 7, 18);
    scene.userData.skirt.material.color.set(dark ? "#3a2b45" : "#e6dcee");
    renderer.toneMappingExposure = dark ? 0.95 : 1.05; hemi.intensity = dark ? 0.3 : 1.0; hemi.color.set(dark ? "#8d7aa6" : "#ffffff"); hemi.groundColor.set(dark ? "#2a1d33" : "#c9b8d6");
    key.intensity = dark ? 1.0 : 1.7; key.color.set(dark ? "#d9c8ff" : "#fff4e8"); rim.intensity = dark ? 1.6 : 0.5;
    floor.material.envMapIntensity = dark ? 0.35 : 0.55; wall.material.envMapIntensity = dark ? 0.15 : 0.3;
    units.forEach((u) => { u.light.intensity = 0; });
  }

  function layout() {
    const gap = 0.36; /* wide enough that no open door or drawer can reach the next unit */ let total = units.reduce((s, u) => s + u.w, 0) + gap * (units.length - 1); let x = -total / 2;
    units.forEach((u) => { u.group.position.set(x + u.w / 2, 0, 0); u.x = x + u.w / 2; x += u.w + gap; });
  }

  /* camera: fit the open unit and the swing of its door, glide there on springs */
  function frameOpen() {
    const u = units.find((q) => q.id === openId); if (!hostEl) return;
    const aspect = camera.aspect, fov = camera.fov * Math.PI / 180;
    if (!u || overview) {   // the main view: step back so the whole row is in sight
      if (!units.length) return;
      const x0 = Math.min(...units.map((q) => q.x - q.w / 2)), x1 = Math.max(...units.map((q) => q.x + q.w / 2)), hh = Math.max(...units.map((q) => q.h));
      const dW = ((x1 - x0 + (overview ? 1.7 : 0.9)) / 2) / (Math.tan(fov / 2) * aspect), dH = ((hh + 0.5) / 2) / Math.tan(fov / 2);
      cam.dist.t = Math.max(dW, dH, 3); elBase = overview ? 0.17 : 0.1; cam.fx.t = (x0 + x1) / 2; cam.fy.t = Math.min(hh * 0.5, 0.95); return;
    }
    const needH = (u.h + 0.62) * 1.0, needW = (u.w + (u.doors.length ? u.w * 0.95 : 0.4) + 0.5);
    const dH = (needH / 2) / Math.tan(fov / 2), dW = (needW / 2) / (Math.tan(fov / 2) * aspect);
    cam.dist.t = Math.max(dH * 0.94, dW * 0.9, u.h < 1.2 ? 3.1 : 2.4) + (u.drawers.length ? 0.9 : 0);   // drawers slide out towards you: leave room
    const shiftX = u.doors.length && u.doors[0].side === "l" ? -u.w * 0.22 : u.doors.length ? 0 : 0;
    elBase = u.h < 1.2 ? 0.52 : 0.07;   // low units are looked down into, so drawers and worktops show their contents
    cam.fx.t = u.x + shiftX; cam.fy.t = Math.min(u.h * 0.5 + 0.04, 1.0);
  }

  function resize() {
    if (!hostEl || !renderer) return; const r = hostEl.getBoundingClientRect(); const w = Math.max(10, r.width), h = Math.max(10, r.height);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); frameOpen(); shadowDirty = true;
  }

  /* ---- items */
  function clearItems(u) { (u.groups || []).forEach((g) => { if (g.parent) g.parent.remove(g); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.userData.m0) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } }); }); u.groups = []; u.nodes = []; }
  function syncItems(items, popUnit) {
    // remember where each item was in the world so a move can fly from there
    const before = new Map(); nodes.forEach((n, id) => { if (!n.grp[0]) return; n.grp[0].getWorldPosition(v3); before.set(id, { pos: v3.clone(), unit: n.unitId, g: n.g }); });
    if (carry && carry.drop) { const b = before.get(carry.id); if (b) b.pos = carry.ghost.position.clone(); }   // a dropped food flies on from your hand
    nodes.clear(); const bumpIds = new Set();
    units.forEach((u) => {
      clearItems(u);
      const mine = items.filter((g) => (u.id === "counter" ? !state.spaces.some((s) => s.id === g.loc) : g.loc === u.id)).sort((a, b) => (a.d ?? 9999) - (b.d ?? 9999) || a.name.localeCompare(b.name));
      u.count = mine.length; u.alerts = mine.filter((g) => (g.d !== null && g.d <= 3) || g.low).length;
      const slots = slotPositions(U_(u)); let si = 0, over = 0;
      // every food gets one unbroken run of places in a single row, so copies of the same thing always sit together; rows fill front first
      const rows = new Map(); slots.forEach((q) => { const k = q.level + "|" + Math.floor(q.order / 100); if (!rows.has(k)) rows.set(k, { row: Math.floor(q.order / 100), level: q.level, list: [], used: 0 }); rows.get(k).list.push(q); });
      const runs = [...rows.values()].sort((a, b) => a.row - b.row || a.level - b.level);
      mine.forEach((g, gi) => {
        const n = { id: g.id, g, unitId: u.id, grp: [], lift: new Spring(0, 220, 16), pop: new Spring(1, 120, 13), t0: 0, hidden: false };
        const copies = copiesOf(g);
        let run = runs.find((r) => r.list.length - r.used >= copies);
        if (!run) run = runs.reduce((best, r) => (r.list.length - r.used > (best ? best.list.length - best.used : 0) ? r : best), null);   // no row is big enough: the roomiest row takes what fits
        const take = run ? Math.min(copies, run.list.length - run.used) : 0;
        for (let c = 0; c < take; c++, si++) {
          const s = run.list[run.used + c]; const grp = buildItem(g); grp.userData.base = s.pos.clone(); grp.userData.parent = s.parent; grp.userData.dr = s.dr;
          const j = hash(g.id * 7 + c); grp.rotation.y = grp.userData.loose ? (j - 0.5) * 0.5 : (j - 0.5) * 0.07; grp.userData.rot0 = grp.rotation.y;
          grp.position.copy(grp.userData.base); s.parent.add(grp); n.grp.push(grp); u.groups.push(grp);
        }
        if (run) run.used += take;
        if (!n.grp.length) over++;   // no place left for this food at all
        nodes.set(g.id, n);
        const b = before.get(g.id);
        if (b && b.unit !== u.id && n.grp[0]) { startFlight(b, u, n); bumpIds.add(u.id); }
      });
      u.placed = si; u.over = over;
    });
    if (carry && carry.drop) { scene.remove(carry.ghost); disposeGhost(carry.ghost); carry = null; cursor(); }
    // anything that moved out of view gets a flight; units that received something do a small bump
    bumpIds.forEach((id) => { const u = units.find((q) => q.id === id); if (u) { u.bump.v = 0; u.bump.vel = 3.2; } });
  }
  const U_ = (u) => u;
  function startFlight(b, targetUnit, n) {
    const src = units.find((q) => q.id === b.unit); const ghost = buildItem(b.g); ghost.position.copy(b.pos); scene.add(ghost);
    const open = targetUnit.ov > 0.5;
    const to = open ? (() => { const gp = n.grp[0]; gp.getWorldPosition(v3); return v3.clone(); })() : new Vector3(targetUnit.x, Math.min(targetUnit.h * 0.55, 1.1), targetUnit.d / 2 + 0.18);
    if (open) n.hidden = true;
    flights.push({ ghost, from: b.pos.clone(), to, f: new Spring(0, 55, 10.5), done: false, open, n, spin: (Math.random() - 0.5) * 2 });
    flights[flights.length - 1].f.t = 1;
  }

  /* ---- pointer */
  function ndc(e) { const r = renderer.domElement.getBoundingClientRect(); px.x = e.clientX; px.y = e.clientY; px.nx = ((e.clientX - r.left) / r.width) * 2 - 1; px.ny = -((e.clientY - r.top) / r.height) * 2 + 1; px.inside = true; px.moved = true; }
  function pick(list) { ray.setFromCamera({ x: px.nx, y: px.ny }, camera); return ray.intersectObjects(list, false)[0] || null; }
  function itemMeshes() {   // anything you can see and reach: in any open unit, in a drawer that is out
    const out = []; nodes.forEach((n) => { const u = units.find((q) => q.id === n.unitId); if (!u || (u.ov < 0.5 && u.xr < 0.5) || n.hidden) return; n.grp.forEach((g) => { if (g.visible) g.traverse((o) => { if (o.isMesh) out.push(o); }); }); }); return out;
  }
  const proxMeshes = () => { const o = []; units.forEach((u) => o.push(...u.proxies)); return o; };
  const pickItem = () => { const i = pick(itemMeshes()); if (!i) return null; const h = pick(proxMeshes()); return h && h.distance < i.distance + 0.35 ? null : i; };   // a handle in reach wins over an item behind it
  const pickUnit = () => pick(proxMeshes()) || pick(unitMeshes());   // handles win over everything else
  const unitOf = (id) => units.find((q) => q.id === id);
  const partsOf = (u) => [...u.doors, ...u.drawers];
  const setPart = (u, p, v) => { p.want = v ? 1 : 0; if (v && (u.exclusive || u.drawers.includes(p))) partsOf(u).forEach((q) => { if (q !== p && (u.exclusive || u.drawers.includes(q))) q.want = 0; }); };   /* only one drawer is out at a time, in every unit */
  const settle = (id) => { const u = unitOf(id); if (u && !isOpen(id) && !overview && (openId === id || openId === null)) setTimeout(() => { if (!isOpen(id) && !overview && (openId === id || openId === null)) setOv(true); }, 120); };   /* shutting the last door or drawer brings the camera back to the main view */
  const isOpen = (id) => { const u = unitOf(id); return !!u && partsOf(u).some((p) => p.want); };
  const popUnit = (id) => { const pu = unitOf(id); if (!pu || pu.alwaysOpen) return; const sec = performance.now() / 1000; let k = 0; nodes.forEach((n) => { if (n.unitId === id) { n.pop.v = 0.001; n.pop.vel = 0; n.pop.t = 0.001; n.t0 = sec + 0.3 + k * 0.04; k++; } }); };
  function setUnit(id, open) {   // open or shut every door and drawer of one unit, then tell the page
    const u = unitOf(id); if (!u) return; const was = isOpen(id); shadowDirty = true;
    if (open && u.exclusive) { if (!isOpen(id)) setPart(u, u.drawers.reduce((a, b) => (b.i > a.i ? b : a)), 1); } else partsOf(u).forEach((p) => { p.want = open ? 1 : 0; });
    if (open && !was) popUnit(id); if (was !== isOpen(id)) setTimeout(() => emit("parts", { id }), 0); if (!open && was) settle(id);
  }
  function unitMeshes() { const out = []; units.forEach((u) => out.push(...u.hitMeshes)); return out; }
  const disposeGhost = (g) => g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  function carryTarget(x, y) {   // where the held food hangs: on a plane in front of the units, under the pointer
    const r = renderer.domElement.getBoundingClientRect(); ray.setFromCamera({ x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 }, camera);
    const out = new Vector3(); if (!ray.ray.intersectPlane(carryPlane, out)) return null; out.y = clamp(out.y, 0.1, 2.1); return out;
  }
  function startCarry(id, x, y) {   // the food leaves its shelf as a real object, lifted into your hand
    const n = nodes.get(id); if (!n || !n.grp[0]) return; const ghost = buildItem(n.g); n.grp[0].getWorldPosition(v3); const home = v3.clone();
    ghost.position.copy(home); scene.add(ghost); carry = { id, ghost, home, vel: new Vector3(), target: carryTarget(x, y) || home.clone(), drop: false, back: false, dropT: 0 }; shadowDirty = true; cursor();
  }
  function onMove(e) {
    ndc(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; cam.zoomT = clamp(pinch.z0 + Math.log(pinch.d0 / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))), ZMIN, ZMAX); return; }   // two fingers: dolly
    if (carry && !carry.back) { const t = carryTarget(e.clientX, e.clientY); if (t) carry.target = t; }
    if (panning) {   // right-drag, middle-drag or Shift-drag: slide the view
      const k = 2 * cam.dist.v * Math.exp(cam.zoom.v) * Math.tan((camera.fov * Math.PI) / 360) / Math.max(1, renderer.domElement.clientHeight);
      panTX = clamp(panning.px - (e.clientX - panning.x) * k, -3, 3); panTY = clamp(panning.py + (e.clientY - panning.y) * k, -0.5, 0.9); return;
    }
    if (orbit) {
      const naz = clamp(orbit.az + (e.clientX - orbit.x) * 0.005, -AZ, AZ), nel = clamp(orbit.el + (e.clientY - orbit.y) * 0.003, EL0, EL1), t = performance.now(), dtm = Math.max(8, t - (orbit.lt || t)) / 1000;
      cam.vAz = lerp(cam.vAz, (naz - cam.userAz) / dtm, 0.4); cam.vEl = lerp(cam.vEl, (nel - cam.userEl) / dtm, 0.4); cam.userAz = naz; cam.userEl = nel; orbit.lt = t;   /* remember the speed so the view keeps drifting when you let go */
    }
    if (pending && !dragging && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 6) {
      if (pending.touch && performance.now() - pending.t < 220) { pending = null; return; }   // a swipe, not a held drag: let the page scroll
      dragging = pending.id; pending = null; setHover(null); emit("dragstart", { id: dragging, x: e.clientX, y: e.clientY }); hideItem(dragging, true); startCarry(dragging, e.clientX, e.clientY); }
  }
  function onDown(e) {
    if (e.button === 3) { back(); e.preventDefault(); return; }   // the mouse Back button
    const wantPan = e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    if (e.button > 0 && !wantPan) return; ndc(e); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (wantPan) { panning = { x: e.clientX, y: e.clientY, px: panTX, py: panTY }; cursor(); e.preventDefault(); return; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), z0: cam.zoomT }; pending = null; orbit = null; return; }
    cam.vAz = cam.vEl = 0; const hit = pickItem();
    if (hit) { pending = { id: hit.object.userData.itemId, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", t: performance.now() }; return; }
    orbit = { x: e.clientX, y: e.clientY, az: cam.userAz, el: cam.userEl, t: performance.now(), moved: false }; cursor();
  }
  function onCancel(e) { if (e && e.pointerId !== undefined) ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (dragging) { hideItem(dragging, false); dragging = null; } pending = null; orbit = null; panning = null; if (renderer) cursor(); }
  function onUp(e) {
    ptrs.delete(e.pointerId); if (pinch) { if (ptrs.size < 2) pinch = null; pending = null; orbit = null; return; }
    if (pending && !dragging) { selId = pending.id; emit("pick", { id: pending.id }); }
    else if (orbit && Math.hypot(e.clientX - orbit.x, e.clientY - orbit.y) < 5) {
      ndc(e); const hit = pickUnit(); const uid = hit && hit.object.userData.unitId;
      const part = hit && hit.object.userData.partRef, un = uid && unitOf(uid);
      const inView = () => { v3.set(un.x, un.h / 2, 0); v3.project(camera); return Math.abs(v3.x) < 0.8 && Math.abs(v3.y) < 0.9; };
      const focus = (go) => {   // select the unit; the camera only moves if it is out of sight, or you click the selected unit in the main view to step in
        if (uid !== openId) { openId = uid; if (!overview && !inView()) { resetView(); frameOpen(); } emit("focus", { id: uid }); }
        else if (go && overview) { overview = false; resetView(); frameOpen(); setTimeout(() => emit("view", {}), 0); }
      };
      const now = performance.now(), prev = lastTap, dbl = part && prev.uid === uid && now - prev.t < 380; lastTap = { t: part && !dbl ? now : 0, uid, allBefore: !!part && partsOf(un).every((q) => q.want) };
      if (dbl && !un.exclusive) {                                                                               // double-click: every door or drawer of the unit together
        const all = prev.allBefore; const was = isOpen(uid); partsOf(un).forEach((q) => { q.want = all ? 0 : 1; }); if (!was && !all) popUnit(uid);
        setTimeout(() => emit("parts", { id: uid }), 0); if (!all) focus(false); else settle(uid);
      } else if (part) {                                                                       // a door or drawer: that one swings or slides, nothing else
        const was = isOpen(uid); setPart(un, part, !part.want); if (!was && part.want) popUnit(uid);
        if (isOpen(uid) !== was) setTimeout(() => emit("parts", { id: uid }), 0); if (part.want) focus(false); else settle(uid);
      } else if (un && un.pv < 0.05) emit("space", { id: uid, keep: true });             // the body of a shut unit: open it all
      else if (un) { focus(true); if (selId) { selId = null; emit("pick", { id: null }); } }       // an open unit: bring it into view
      else {                                                                                   // empty room: let go of the item, double-click to reset the view
        const had = !!selId; if (had) { selId = null; emit("pick", { id: null }); }
        const t = performance.now(); clearTimeout(backTimer);
        if (t - lastEmpty < 380) { resetView(); lastEmpty = 0; }
        else { lastEmpty = t; if (!had && !overview) backTimer = setTimeout(() => { if (!overview && !selId) setOv(true); }, 300); }   // a lone click on empty room steps back to the main view
      }
    }
    pending = null; orbit = null; panning = null; if (renderer) cursor();
  }
  let dragPart = null, dragUnit = null, dragPartT = 0, dragSeen = 0;   // a held food over a shut door or drawer for a moment opens it
  let lastTap = { t: 0, uid: null }, shadowDirty = true, itemSig = null, lastHitT = 0, lastHoverKey = null;
  const unsettled = (sp) => Math.abs(sp.t - sp.v) > 0.0008 || Math.abs(sp.vel) > 0.01;
  let unitHover = null, partHover = null;
  function setPartHover(p, hit) {   // which door or drawer is under the pointer, and what a click would do
    p = p || null; if (p === partHover) return; partHover = p;
    if (!p) return emit("parthint", null);
    const u = unitOf(hit.object.userData.unitId), n = partsOf(u).length, kind = u.drawers.length ? "drawer" : "door";
    emit("parthint", { text: `${p.want ? "Close" : "Open"} ${kind}`, sub: n > 1 && !u.exclusive ? `Double-click for all ${n}` : u.exclusive ? "One drawer at a time" : "", x: px.x, y: px.y });
  }
  const cursor = () => { renderer.domElement.style.cursor = carry || panning || orbit ? "grabbing" : hoverId ? "grab" : unitHover ? "pointer" : ""; };
  function setHover(id) { if (id === hoverId) return; hoverId = id; cursor(); if (!id) { lastHoverKey = null; emit("hover", null); } }
  function setUnitHover(id) { if (id === unitHover) return; unitHover = id; cursor(); }
  function hideItem(id, hidden) { const n = nodes.get(id); if (n) n.hidden = hidden; }

  /* ---- the loop */
  function frame(now) {
    raf = requestAnimationFrame(frame); if (!hostEl || document.hidden) return;
    const gapMs = now - last; const dt = Math.min(0.08, gapMs / 1000 || 0.016); last = now; const sec = now / 1000;
    // units: doors, drawers, lights
    let active = units.find((u) => u.id === openId); let anim = shadowDirty; shadowDirty = false;   // anim: did anything move this frame (then the shadows are redrawn)
    units.forEach((u) => {
      anim = anim || unsettled(u.bump) || unsettled(u.hl) || u.doors.some((d) => unsettled(d.s)) || u.drawers.some((d) => unsettled(d.slide));
      u.bump.step(dt); u.hl.t = dropHover === u.id ? 1 : unitHover === u.id ? 0.55 : 0; u.hl.step(dt);
      // every door and drawer has its own spring, so any of them can be open or shut on its own
      u.doors.forEach((d) => { d.s.t = d.want; d.s.step(dt); const a = clamp(d.s.v, -0.05, 1.06) * d.max; d.p.rotation.y = d.side === "l" ? -a : a; });
      u.drawers.forEach((dr) => { dr.slide.t = dr.want; dr.slide.k = 90 - dr.i * 5; dr.slide.c = 1.9 * Math.sqrt(dr.slide.k); dr.slide.step(dt); dr.g.position.z = dr.slide.v * (u.exclusive ? 0.46 : 0.5 - dr.i * 0.1); });   // lower drawers come out further, so none hides another
      partsOf(u).forEach((p) => { const hvT = p === partHover ? 1 : 0; if (Math.abs(hvT - p.hv) > 0.004) anim = true; p.hv += (hvT - p.hv) * Math.min(1, dt * 12); p.hot.forEach((m) => { m.material.emissive.set("#e2c8ff"); m.material.emissiveIntensity = p.hv * 1.1; }); });
      u.pv = clamp(Math.max(0, ...u.doors.map((d) => d.s.v), ...u.drawers.map((d) => d.slide.v)), 0, 1); u.ov = u.alwaysOpen ? 1 : u.pv;   // ov: can you see its contents, pv: how far its doors are open
      const xt = xray && u.id === openId && u.count > 0 && !u.alwaysOpen ? 1 : 0;   // nothing hidden, nothing to reveal: no fade
      if (Math.abs(xt - u.xr) > 0.002) { u.xr += (xt - u.xr) * Math.min(1, dt * 7); anim = true; } else u.xr = xt;
      u.xmats.forEach((m) => { m.opacity = 1 - 0.62 * u.xr; m.depthWrite = u.xr < 0.05; });
      const cs = u.xr < 0.15; u.xmeshes.forEach((m) => { if (m.castShadow !== cs) { m.castShadow = cs; shadowDirty = true; } });   // a see-through door must not shade what it reveals
      u.drawers.forEach((dr) => {   // a drawer front fades only while the drawer is shut; once it is out you see straight into it
        if (!dr.fmat) return; const k = u.xr * (1 - clamp(dr.slide.v * 1.6, 0, 1)); dr.fmat.opacity = 1 - 0.62 * k; dr.fmat.depthWrite = k < 0.05;
        if (dr.fmesh.castShadow !== k < 0.15) { dr.fmesh.castShadow = k < 0.15; shadowDirty = true; }
        if (dr.fmat.emissive) { dr.fmat.emissive.set("#efe2ff"); dr.fmat.emissiveIntensity = u.hl.v * 0.14; }
      });
      const o = Math.max(u.pv, u.xr * 0.35); u.light.intensity = (theme === "dark" ? 1.25 : 0.35) * o; u.liner.emissiveIntensity = (theme === "dark" ? 0.16 : 0.035) * o;
      if (u.strip) u.strip.emissiveIntensity = 0.3 + 1.4 * o;
      const s = 1 + u.bump.v * 0.035; u.group.scale.set(s, s, s); u.group.position.y = 0;
      if (u.shell.emissive) { u.shell.emissive.set("#efe2ff"); u.shell.emissiveIntensity = u.hl.v * 0.14; }
      if (u.xmats[0].emissive) { u.xmats[0].emissive.set("#efe2ff"); u.xmats[0].emissiveIntensity = u.hl.v * 0.14; }
      u.itemsRoot.visible = u.ov > 0.02;
    });
    if (active) { spot.position.set(active.x, active.h - 0.12, active.d / 2 - 0.12); spot.target.position.set(active.x, active.h * 0.42, -active.d / 2 + 0.15); spot.intensity = (theme === "dark" ? 9 : 2.4) * active.ov; spot.angle = 1.0; }
    // items: pop in, lift on hover, follow springs
    const pxl = px.moved && px.inside && !pending && !dragging && !orbit; px.moved = false;
    if (pxl) {
      const h = pickItem(); if (h) { lastHitT = now; setHover(h.object.userData.itemId); } else if (!hoverId || now - lastHitT > 160) setHover(null);
      const uh = h || hoverId ? null : pickUnit(); const uid = uh && uh.object.userData.unitId; setPartHover(uh && uh.object.userData.partRef, uh);
      setUnitHover(uid && (uh.object.userData.partRef || units.find((q) => q.id === uid).pv < 0.05) ? uid : null);   // lights up only where a click would do something
    } else if (!px.inside) { setUnitHover(null); setPartHover(null); }
    if (dragPart && now - dragSeen < 220 && now - dragPartT > 240 && !dragPart.want) {   // dwell over a shut drawer: it opens (a freezer shuts the one that was out)
      const u = unitOf(dragUnit); if (u) { const was = isOpen(u.id); setPart(u, dragPart, true); shadowDirty = true; if (!was) popUnit(u.id); setTimeout(() => emit("parts", { id: u.id }), 0); }
      dragPart = null;
    }
    if (carry) {
      const c = carry, g = c.ghost, to = c.back ? c.home : c.target; if (c.drop && now - c.dropT > 900) { c.drop = false; c.back = true; }   // a drop that never landed: put it back
      ["x", "y", "z"].forEach((ax) => { c.vel[ax] += ((to[ax] - g.position[ax]) * 220 - c.vel[ax] * 24) * dt; }); g.position.addScaledVector(c.vel, dt);
      const f = Math.min(1, dt * 12); g.rotation.z = lerp(g.rotation.z, clamp(-c.vel.x * 0.22, -0.5, 0.5), f); g.rotation.x = lerp(g.rotation.x, clamp(c.vel.y * 0.12, -0.4, 0.4), f);
      g.scale.setScalar(lerp(g.scale.x, c.back ? 1 : 1.14, Math.min(1, dt * 10))); anim = true;
      if (c.back && g.position.distanceTo(c.home) < 0.012 && c.vel.length() < 0.2) { scene.remove(g); disposeGhost(g); hideItem(c.id, false); carry = null; cursor(); }
    }
    if (!active) spot.intensity = 0;
    nodes.forEach((n, id) => {
      const u = units.find((q) => q.id === n.unitId); if (!u) return;
      const hov = id === hoverId, sel = id === selId;
      n.lift.t = hov || sel ? 0.032 : 0; anim = anim || unsettled(n.lift) || unsettled(n.pop); n.lift.step(dt);
      if (sec >= n.t0) n.pop.t = 1; n.pop.step(dt);
      const see = u.xr > 0.5, vis = !n.hidden && (u.ov > 0.02 || see);   // contents show through the faded doors even when shut
      n.grp.forEach((g, ci) => {
        g.visible = vis && (!g.userData.dr || g.userData.dr.slide.v > 0.12 || see); /* things in a shut drawer are out of sight */ const sc = Math.max(0.001, n.pop.v); g.scale.setScalar(sc);
        g.position.set(g.userData.base.x, g.userData.base.y + n.lift.v * (ci === 0 ? 1 : 0.6) + (1 - clamp(n.pop.v, 0, 1)) * 0.05, g.userData.base.z);
        if (ci === 0) { let tgt = 0; if (hov) { v3.copy(g.userData.base); g.userData.parent.localToWorld(v3); v3.project(camera); tgt = clamp((px.nx - v3.x) * 0.9, -0.45, 0.45); } g.userData.ry = lerp(g.userData.ry || 0, tgt, Math.min(1, dt * 9)); }
        g.rotation.y = (g.userData.rot0 || 0) + (ci === 0 ? g.userData.ry || 0 : 0);
        const on = sel ? 0.3 : hov ? 0.14 : 0;
        if (g.userData.on !== on) {
          g.userData.on = on;
          g.traverse((o) => {
            if (!o.isMesh) return;
            if (on > 0) { if (!o.userData.m0) { o.userData.m0 = o.material; o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); } (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.emissive) { m.emissive.set("#c9a0e6"); m.emissiveIntensity = on; } }); }
            else if (o.userData.m0) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); o.material = o.userData.m0; o.userData.m0 = null; }
          });
          anim = true;
        }
      });
    });
    if (hoverId && nodes.get(hoverId)) {   // the tooltip hangs over the shelf spot, so it does not bob with the item
      const g = nodes.get(hoverId).grp[0];
      if (g) {
        const gp = g.userData.parent.localToWorld(g.userData.base.clone()); gp.y += (g.userData.h || 0.1) + 0.04; const p = gp.project(camera), r = renderer.domElement.getBoundingClientRect();
        const x = Math.round(r.left + (p.x * 0.5 + 0.5) * r.width), y = Math.round(r.top + (-p.y * 0.5 + 0.5) * r.height), key = hoverId + ":" + x + ":" + y;
        if (key !== lastHoverKey) { lastHoverKey = key; emit("hover", { id: hoverId, x, y }); }
      }
    }
    // flights between units: a lifted arc, a little spin, then it goes in through the door
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]; f.f.step(dt); const t = clamp(f.f.v, 0, 1.05);
      f.ghost.position.lerpVectors(f.from, f.to, t); f.ghost.position.y += Math.sin(Math.min(1, t) * Math.PI) * 0.35; f.ghost.rotation.y = f.spin * t * 3; f.ghost.rotation.z = Math.sin(t * Math.PI) * f.spin * 0.4;
      const sc = f.open ? 1 : (t > 0.78 ? Math.max(0.001, 1 - (t - 0.78) / 0.22) : 1); f.ghost.scale.setScalar(sc);
      if (f.f.v > 0.985 && Math.abs(f.f.vel) < 0.2) { scene.remove(f.ghost); if (f.open) f.n.hidden = false; flights.splice(i, 1); }
    }
    // camera
    anim = anim || flights.length > 0 || [cam.fx, cam.fy, cam.dist, cam.az, cam.el, cam.zoom, panS.x, panS.y].some(unsettled) || cam.vAz !== 0 || cam.vEl !== 0 || keys.size > 0; if (anim) renderer.shadowMap.needsUpdate = true;
    cam.fx.step(dt); cam.fy.step(dt); cam.dist.step(dt);
    const kx = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0), ky = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0), kz = (keys.has("-") || keys.has("_") ? 1 : 0) - (keys.has("+") || keys.has("=") ? 1 : 0);
    if (!orbit && !pinch) {
      if (kx || ky) { cam.vAz = kx * 0.9; cam.vEl = ky * 0.55; }   /* held keys glide the view, easing off like a hand on a rig */
      cam.userAz = clamp(cam.userAz + cam.vAz * dt, -AZ, AZ); cam.userEl = clamp(cam.userEl + cam.vEl * dt, EL0, EL1);
      if (cam.userAz <= -AZ || cam.userAz >= AZ) cam.vAz = 0; if (cam.userEl <= EL0 || cam.userEl >= EL1) cam.vEl = 0;
      const decay = Math.exp(-dt * (kx || ky ? 9 : 3.2)); cam.vAz *= decay; cam.vEl *= decay; if (Math.abs(cam.vAz) < 0.002) cam.vAz = 0; if (Math.abs(cam.vEl) < 0.002) cam.vEl = 0;
    }
    if (kz) cam.zoomT = clamp(cam.zoomT + kz * 0.8 * dt, ZMIN, ZMAX);
    cam.zoom.t = cam.zoomT; cam.zoom.step(dt); panS.x.t = panTX; panS.y.t = panTY; panS.x.step(dt); panS.y.step(dt);
    const hold = hoverId || partHover || unitHover || carry || pending || orbit || panning || pinch;   // never let the scene drift under a target you are aiming at
    if (!hold) { const tx = REDUCE || !px.inside ? 0 : px.nx * 0.018, ty = REDUCE || !px.inside ? 0 : px.ny * 0.007, f = Math.min(1, dt * 2.5); parX += (tx - parX) * f; parY += (ty - parY) * f; }
    const par = parX, sway = REDUCE || px.inside || orbit ? 0 : Math.sin(sec * 0.33) * 0.011;   /* a very slight idle drift keeps the room alive */
    cam.az.t = cam.userAz + par + sway - 0.1; cam.el.t = elBase + cam.userEl + parY; cam.az.step(dt); cam.el.step(dt);
    const R = cam.dist.v * Math.exp(cam.zoom.v); camera.position.set(cam.fx.v + panS.x.v + Math.sin(cam.az.v) * R, cam.fy.v + panS.y.v + Math.sin(cam.el.v) * R + 0.15, Math.cos(cam.az.v) * Math.cos(cam.el.v) * R);
    camera.position.y = Math.max(0.22, camera.position.y);   // low angles, but never through the floor
    camera.lookAt(cam.fx.v + panS.x.v, cam.fy.v + panS.y.v, 0);
    if (scene.fog) { scene.fog.near = R * 1.15 + 2; scene.fog.far = R * 1.15 + 11; }
    key.position.set(cam.fx.v + 1.4, 5.2, 4.6); key.target.position.set(cam.fx.v, 0.8, 0);
    if (!REDUCE || anim) { renderer.render(scene, camera); placeLabels(); }   // reduced motion: nothing drifts on its own, so redraw only when something moved
    // slow device? quietly trade shadow softness for smoothness
    const ft = Math.max(performance.now() - now, gapMs); if (ft > 38) { slowFrames++; goodFrames = 0; } else { goodFrames++; if (goodFrames > 20) slowFrames = 0; }
    if (slowFrames > 25) degrade();
    if (!REDUCE && probeN < 10) { probeN++; if (probeN > 4) probe.push(ft); if (probeN === 10) { probe.sort((a, b) => a - b); if (probe[probe.length >> 1] > 250) emit("slow", {}); } }   // the first frames compile shaders, so judge the next few
  }

  const setOv = (on) => { overview = !!on; resetView(); frameOpen(); setTimeout(() => emit("view", {}), 0); };   // the main view: the whole kitchen from the centre
  function back() {   // one step out each time: let go of the item, then return to the main view
    if (selId) { selId = null; emit("pick", { id: null }); return "item"; }
    if (!overview) { setOv(true); return "view"; }
    return null;
  }
  function slideView(dir) {   // from the selected unit, glide sideways to the next one without changing what is selected
    const f = unitOf(openId); if (!f || overview) return; const cx = f.x + panTX, o = [...units].sort((a, b) => a.x - b.x);
    const next = dir > 0 ? o.find((u) => u.x > cx + 0.05) : [...o].reverse().find((u) => u.x < cx - 0.05); if (next) panTX = clamp(next.x - f.x, -3, 3);
  }
  /* ---- the room as a keyboard and wheel target (click it or Tab to it first) */
  const zoomPlane = new Plane(new Vector3(0, 0, 1), 0);
  function bindRoom(el) {
    el.addEventListener("wheel", (e) => {   /* the wheel dollies the view toward (or away from) the point under the pointer */
      const now = performance.now();
      if (overview && e.deltaY > 0 && !(e.ctrlKey || e.metaKey)) return;       /* already zoomed all the way out: let the page scroll */
      e.preventDefault();
      if (now < wheelLock) return;
      const z = cam.zoomT + e.deltaY * 0.0012;
      if (z > ZMAX + 0.05 && !overview) { wheelLock = now + 500; setOv(true); return; }                 /* scroll out past the limit: back to the main view */
      if (overview) { if (e.deltaY < -4 && openId) { wheelLock = now + 500; overview = false; resetView(); frameOpen(); setTimeout(() => emit("view", {}), 0); } return; }   /* scroll in: step into the selected unit */
      const to = clamp(z, ZMIN, ZMAX), s = Math.exp(to - cam.zoomT); cam.zoomT = to;
      const r = renderer.domElement.getBoundingClientRect(); ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
      const hit = new Vector3();
      if (Math.abs(s - 1) > 1e-4 && ray.ray.intersectPlane(zoomPlane, hit)) {   /* keep that point under the pointer: the view centre slides toward it as you zoom in, away as you zoom out */
        const tx = cam.fx.t + panTX, ty = cam.fy.t + panTY;
        panTX = clamp(panTX + (hit.x - tx) * (1 - s), -3, 3); panTY = clamp(panTY + (hit.y - ty) * (1 - s), -0.5, 0.9);
      }
    }, { passive: false });
  }
  /* Keys work whenever the pointer is over the room or the room has focus. Each held key is remembered by its physical key (e.code),
     so a plus typed as Shift and = (or a dedicated key on another layout) always lets go cleanly, whichever key is released first. */
  const held = new Map();
  function bindKeys() {
    const order = () => [...units].sort((a, b) => a.x - b.x);
    const step = (d) => { const o = order(); if (!o.length) return; const i = o.findIndex((u) => u.id === openId); const n = o[(i < 0 ? (d > 0 ? 0 : o.length - 1) : (i + d + o.length) % o.length)]; emit("space", { id: n.id }); };
    const canon = (e) => { const k = e.key; if (k === "+" || k === "=" || k === "Add") return "+"; if (k === "-" || k === "_" || k === "Subtract") return "-"; return k.indexOf("Arrow") === 0 ? k : null; };
    const live = (e) => {
      if (!hostEl || !renderer || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]:not(.gt-help),[role="alertdialog"]')) return false;
      const t = e.target; if (t && t.closest && t.closest("input, textarea, select, [contenteditable], [role=tablist]")) return false;
      return px.inside || hostEl.contains(document.activeElement);
    };
    listen(window, "keydown", (e) => {
      if (!live(e)) return; const k = e.key, c = canon(e), onBtn = e.target && e.target.closest && e.target.closest("button, a");
      if (e.shiftKey && (k === "ArrowLeft" || k === "ArrowRight")) { slideView(k === "ArrowRight" ? 1 : -1); e.preventDefault(); return; }
      if (c) { keys.add(c); held.set(e.code, c); e.preventDefault(); return; }
      if (k === "0") { resetView(); e.preventDefault(); }
      else if (k === "Home" || k === "o" || k === "O") { setOv(!overview); e.preventDefault(); }
      else if (k === "," || k === "[" || k === "PageUp") { step(-1); e.preventDefault(); }
      else if (k === "." || k === "]" || k === "PageDown") { step(1); e.preventDefault(); }
      else if ((k === "Enter" || k === " ") && !onBtn) { const o = order(); const id = openId || (o[0] && o[0].id); if (id) emit("space", { id }); e.preventDefault(); }
    });
    listen(window, "keyup", (e) => { const c = held.get(e.code); if (c) { keys.delete(c); held.delete(e.code); } });
    listen(window, "blur", () => { keys.clear(); held.clear(); });
  }

  /* ---- plinth labels: real buttons, positioned under each unit (also the keyboard route and a drop target) */
  const labelMap = new Map();
  function buildLabels() {
    labelsEl.innerHTML = ""; labelMap.clear();
    units.forEach((u) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "gt-ulabel"; b.dataset.space = u.id; b.addEventListener("click", () => emit("space", { id: u.id }));
      labelsEl.appendChild(b); labelMap.set(u.id, b);
    });
  }
  const lastTxt = new Map();
  function placeLabels() {
    if (!hostEl) return; const r = renderer.domElement.getBoundingClientRect();
    units.forEach((u) => {
      const b = labelMap.get(u.id); if (!b) return;
      v3.set(u.x, 0.0, u.d / 2 + 0.2); const p = v3.clone().project(camera);   // on the floor in front of the unit, clear of every handle
      const bw = b.offsetWidth || 96; const x = clamp((p.x * 0.5 + 0.5) * r.width, bw / 2 + 8, r.width - bw / 2 - 8), y = clamp((-p.y * 0.5 + 0.5) * r.height, 8, r.height - 42); b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
      const op = u.pv > 0.3;
      const txt = `${u.name}|${u.count}|${u.alerts}|${op}`;
      if (lastTxt.get(u.id) !== txt) { lastTxt.set(u.id, txt); b.classList.toggle("on", op); b.classList.toggle("alert", u.alerts > 0); b.innerHTML = `<span>${esc(u.name)}</span><b>${u.count}</b><span class="sr-only"> items${u.alerts ? `, ${u.alerts} low or going off soon` : ""}</span>`; b.setAttribute("aria-pressed", op); }
      b.classList.toggle("drop", dropHover === u.id); const hide = u.id === openId || Math.abs(p.x) > 1.02;   // the open unit and anything out of view need no label
      b.style.opacity = hide ? 0 : 1; b.style.pointerEvents = hide ? "none" : "auto";
    });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---- public api */
  return {
    ready: true,
    on(name, fn) { handlers[name] = fn; },
    /* where an item's first copy is on screen right now (client pixels), or null when it is out of sight */
    itemScreenPos(id) {
      const n = nodes.get(id); const g = n && n.grp[0]; if (!g || !g.visible || !renderer) return null;
      g.updateWorldMatrix(true, false); v3.set(0, (g.userData.h || 0.1) / 2, 0); g.localToWorld(v3); v3.project(camera);
      const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height };
    },
    dispose() {
      if (disposed) return; disposed = true; cancelAnimationFrame(raf); raf = 0; clearTimeout(backTimer); offs.forEach((f) => f()); offs.length = 0;
      if (ro) ro.disconnect();
      if (scene) scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
      if (labelsEl && labelsEl.parentNode) labelsEl.parentNode.removeChild(labelsEl);
      hostEl = null; units = []; nodes.clear(); flights.length = 0;
    },
    capacity(kind) { return { fridge: 4 * 5 * 3, freezer: 3 * 5 * 3, pantry: 4 * 7 * 2, cupboard: 2 * 5 * 3, counter: 10 * 3 }[kind] || 20; },
    attach(el) {
      if (!renderer) init();
      if (hostEl && hostEl !== el) ro.unobserve(hostEl);
      hostEl = el;
      if (!el) { cancelAnimationFrame(raf); raf = 0; return; }
      if (!el._k3d) { el._k3d = true; bindRoom(el); }
      if (renderer.domElement.parentNode !== el) el.appendChild(renderer.domElement); if (labelsEl.parentNode !== el) el.appendChild(labelsEl); ro.observe(el); resize();
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    sync(st) {
      if (!renderer) init(); state = st; if (st.theme !== theme) setTheme(st.theme);
      const defs = st.spaces.map((s) => ({ id: s.id, kind: s.kind, name: s.name })); if (st.hasCounter) defs.push({ id: "counter", kind: "counter", name: "Out on the counter" });
      const sig = defs.map((d) => d.id + d.kind + d.name).join("|");
      if (sig !== units.sig) {
        shadowDirty = true;
        units.forEach((u) => scene.remove(u.group)); nodes.clear(); units = defs.map(buildUnit); units.sig = sig; itemSig = null; units.forEach((u) => scene.add(u.group)); layout(); buildLabels(); lastTxt.clear(); if (openId && unitOf(openId)) setUnit(openId, true);
      }
      const isig = st.spaces.map((q) => q.id).join(",") + "#" + st.items.map((g) => [g.id, g.name, g.qty, g.unit, g.cat, g.loc, g.d, g.low].join(":")).join("|");
      if (isig !== itemSig) { itemSig = isig; shadowDirty = true; syncItems(st.items, null); }   // selecting or hovering must not rebuild the shelves
      selId = st.sel; if (hostEl) frameOpen();
    },
    open(id, keep) {
      id = id || null; if (id === openId && (!id || isOpen(id))) return; if (id && !keep) overview = false;   // select the unit and open all of it; null shuts the one that was selected
      const prev = openId; openId = id; if (id) { setUnit(id, true); if (prev && prev !== id) setUnit(prev, false); } else if (prev) setUnit(prev, false);
      resetView(); frameOpen();
    },
    focus(id, keep) { if (id === openId) return; openId = id || null; if (id && !keep) overview = false; resetView(); frameOpen(); },   // bring a unit into view without touching its doors
    closeUnit(id) { setUnit(id, false); },
    openUnit(id) { setUnit(id, true); },
    closeAll() { units.forEach((u) => setUnit(u.id, false)); openId = null; resetView(); frameOpen(); },
    isOpen,
    back,
    setOverview: setOv, isOverview: () => overview, setXray(b) { if (xray !== !!b) { xray = !!b; shadowDirty = true; } }, isXray: () => xray, slide: slideView,
    refreshItems() { labelCache.clear(); [...mats.keys()].filter((k) => k[0] === "l").forEach((k) => mats.delete(k)); if (state) { syncItems(state.items); shadowDirty = true; } },
    stat(id) { const u = unitOf(id); return u ? { cap: u.capacity || 1, placed: u.placed || 0, over: u.over || 0 } : { cap: 1, placed: 0, over: 0 }; },
    parts(id) { const u = unitOf(id); if (!u) return { n: 0, open: 0, kind: "none" }; const ps = partsOf(u); return { n: ps.length, open: ps.filter((p) => p.want).length, kind: u.drawers.length ? "drawer" : "door", exclusive: !!u.exclusive }; },
    openCount: () => units.filter((u) => isOpen(u.id)).length,
    setSelected(id) { selId = id; },
    setTheme,
    endDrag(id, dropped) {
      dragging = null; dragPart = null; partHover = null; dropHover = null;
      if (carry && carry.id === id) { if (dropped) { carry.drop = true; carry.dropT = performance.now(); } else carry.back = true; } else if (id) hideItem(id, false);
      if (renderer) cursor();
    },
    dragOver(x, y) {
      if (!renderer) return null; if (carry && !carry.back) { const t = carryTarget(x, y); if (t) carry.target = t; } const r = renderer.domElement.getBoundingClientRect(); let id = null;
      for (const [uid, b] of labelMap) { const lr = b.getBoundingClientRect(); if (x >= lr.left && x <= lr.right && y >= lr.top && y <= lr.bottom) id = uid; }
      if (!id && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { px.nx = ((x - r.left) / r.width) * 2 - 1; px.ny = -((y - r.top) / r.height) * 2 + 1; const hit = pickUnit(); if (hit) id = hit.object.userData.unitId;
        const pr = (hit && hit.object.userData.partRef) || null, t = performance.now(); dragSeen = t;
        if (pr !== dragPart) { dragPart = pr; dragUnit = pr ? id : null; dragPartT = t; }
        partHover = pr;
      } else dragPart = null;
      dropHover = id; return id;
    },
    openId: () => openId,
  };
}
