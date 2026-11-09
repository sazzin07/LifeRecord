/* Drawn food illustrations (flat, one outline weight). One set serves the 3D packaging labels and the 2D lists, so a food looks the same everywhere.
 Each drawer works in a -1..1 box. No licensed images, no downloads, nothing to host. */
const INK = "#3a2447";
const S = (c, col, path, lw = 0.07) => { c.beginPath(); path(c); c.fillStyle = col; c.fill(); if (lw) { c.lineWidth = lw; c.strokeStyle = INK; c.lineJoin = "round"; c.lineCap = "round"; c.stroke(); } };
const line = (c, col, lw, path) => { c.beginPath(); path(c); c.lineWidth = lw; c.strokeStyle = col; c.lineCap = "round"; c.lineJoin = "round"; c.stroke(); };
const rr = (x, y, w, h, r) => (c) => c.roundRect(x, y, w, h, r);
const el = (x, y, rx, ry, rot = 0) => (c) => c.ellipse(x, y, rx, ry, rot, 0, 7);
const poly = (...p) => (c) => { c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); };
const dot = (c, col, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = col; c.fill(); };

const G = {
  milk(c) { S(c, "#fff", rr(-0.4, -0.2, 0.8, 1.0, 0.06)); S(c, "#dfe8ff", poly(-0.4, -0.2, -0.28, -0.62, 0.28, -0.62, 0.4, -0.2)); S(c, "#4f7fe6", poly(-0.4, 0.05, 0.4, 0.05, 0.4, 0.2, -0.4, 0.2), 0); S(c, "#4f7fe6", el(0, 0.5, 0.17, 0.2), 0.05); dot(c, "#fff", -0.05, 0.45, 0.05); },
  egg(c) { S(c, "#f1e2c4", el(-0.42, 0.28, 0.3, 0.38)); S(c, "#f1e2c4", el(0.42, 0.28, 0.3, 0.38)); S(c, "#fff6e4", el(0, -0.12, 0.34, 0.44)); line(c, "#fff", 0.07, (x) => x.arc(0, -0.12, 0.2, 3.7, 4.5)); },
  bread(c) { S(c, "#d28a42", rr(-0.82, -0.02, 1.64, 0.7, 0.26)); S(c, "#e0a158", el(0, -0.05, 0.78, 0.42)); [-0.4, 0, 0.4].forEach((x) => line(c, "#f7d7a0", 0.08, (p) => { p.moveTo(x - 0.1, -0.2); p.lineTo(x + 0.1, 0.02); })); },
  banana(c) { S(c, "#f4cf45", (x) => { x.moveTo(-0.72, -0.32); x.quadraticCurveTo(-0.3, 0.9, 0.82, 0.12); x.quadraticCurveTo(0.9, -0.1, 0.72, -0.1); x.quadraticCurveTo(0.1, 0.4, -0.5, -0.5); x.closePath(); }); S(c, "#7a5230", rr(-0.82, -0.52, 0.2, 0.26, 0.05), 0.05); line(c, "#d9a92a", 0.05, (x) => { x.moveTo(-0.45, -0.2); x.quadraticCurveTo(-0.1, 0.45, 0.6, 0.12); }); },
  tomato(c) { S(c, "#e0463a", el(0, 0.12, 0.7, 0.62)); S(c, "#3aa86f", (x) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 - 1.57; x.moveTo(0, -0.42); x.quadraticCurveTo(Math.cos(a) * 0.5, -0.42 + Math.sin(a) * 0.4, Math.cos(a + 0.5) * 0.12, -0.42 + Math.sin(a + 0.5) * 0.1); } }, 0.05); dot(c, "rgba(255,255,255,.55)", -0.32, 0.0, 0.1); },
  leaf(c) { S(c, "#3aa86f", (x) => { x.moveTo(-0.7, 0.6); x.bezierCurveTo(-0.9, -0.4, 0.1, -0.9, 0.8, -0.7); x.bezierCurveTo(0.9, 0.1, 0.3, 0.8, -0.7, 0.6); }); line(c, "#a6e6bf", 0.07, (x) => { x.moveTo(-0.6, 0.55); x.quadraticCurveTo(0, 0, 0.62, -0.58); }); },
  chicken(c) { S(c, "#efe3c8", rr(0.1, 0.18, 0.78, 0.2, 0.1), 0.06); S(c, "#efe3c8", el(0.9, 0.17, 0.13, 0.13), 0.06); S(c, "#efe3c8", el(0.9, 0.42, 0.13, 0.13), 0.06); c.save(); c.translate(-0.15, -0.12); c.rotate(-0.55); S(c, "#d98a4b", el(0, 0, 0.55, 0.46)); line(c, "#f0b985", 0.07, (x) => x.arc(-0.05, -0.05, 0.28, 3.4, 4.8)); c.restore(); },
  fish(c) { S(c, "#5aa9d6", poly(0.5, 0, 0.95, -0.4, 0.95, 0.4)); S(c, "#5aa9d6", el(-0.1, 0, 0.66, 0.4)); S(c, "#8fcdef", el(-0.1, 0.15, 0.5, 0.18), 0); dot(c, "#fff", -0.45, -0.08, 0.1); dot(c, INK, -0.45, -0.08, 0.04); line(c, "#2f7fb0", 0.05, (x) => { x.moveTo(0.1, -0.25); x.quadraticCurveTo(0.2, 0, 0.1, 0.25); }); },
  cheese(c) { S(c, "#f2c14b", poly(-0.85, 0.5, 0.85, 0.5, 0.85, -0.05, -0.85, 0.5)); S(c, "#f7d77b", poly(-0.85, 0.5, 0.85, -0.05, 0.85, -0.3, -0.5, -0.1, -0.85, 0.2), 0.06); dot(c, "#d9a42c", 0.4, 0.3, 0.11); dot(c, "#d9a42c", -0.1, 0.38, 0.08); dot(c, "#d9a42c", 0.65, 0.05, 0.07); },
  yoghurt(c) { S(c, "#fff", poly(-0.55, -0.35, 0.55, -0.35, 0.4, 0.8, -0.4, 0.8)); S(c, "#e7e3ee", rr(-0.62, -0.5, 1.24, 0.2, 0.08)); S(c, "#d94f93", poly(-0.5, 0.05, 0.5, 0.05, 0.46, 0.3, -0.46, 0.3), 0); dot(c, "#fff", 0, 0.17, 0.07); },
  peas(c) { c.save(); c.rotate(-0.4); S(c, "#4aa85a", el(0, 0, 0.88, 0.34)); [-0.5, -0.17, 0.17, 0.5].forEach((x) => S(c, "#9be58f", el(x, 0, 0.15, 0.15), 0.05)); c.restore(); },
  jar(c) { S(c, "#fff", rr(-0.48, -0.4, 0.96, 1.2, 0.18)); S(c, "#b3263f", rr(-0.4, -0.2, 0.8, 0.9, 0.12), 0); S(c, "#c9a14a", rr(-0.54, -0.62, 1.08, 0.26, 0.07)); S(c, "#fff6e4", el(0, 0.28, 0.24, 0.2), 0.04); },
  can(c) { S(c, "#d6dae2", rr(-0.5, -0.55, 1, 1.3, 0.1)); S(c, "#e0463a", poly(-0.5, -0.15, 0.5, -0.15, 0.5, 0.4, -0.5, 0.4), 0); S(c, "#fff6e4", el(0, 0.13, 0.28, 0.2), 0.04); line(c, "#9aa0ad", 0.05, (x) => { x.moveTo(-0.5, -0.4); x.lineTo(0.5, -0.4); }); },
  bottle(c) { S(c, "#e3b82f", (x) => { x.roundRect(-0.38, -0.05, 0.76, 0.85, 0.2); }); S(c, "#e3b82f", rr(-0.17, -0.5, 0.34, 0.5, 0.08)); S(c, "#2a1433", rr(-0.2, -0.72, 0.4, 0.22, 0.06), 0.05); S(c, "#fff6e4", rr(-0.3, 0.12, 0.6, 0.4, 0.07), 0.04); },
  rice(c) { S(c, "#e7e9f0", (x) => { x.moveTo(-0.85, 0.05); x.lineTo(0.85, 0.05); x.quadraticCurveTo(0.8, 0.85, 0, 0.85); x.quadraticCurveTo(-0.8, 0.85, -0.85, 0.05); }); S(c, "#fff", (x) => { x.moveTo(-0.72, 0.05); x.quadraticCurveTo(0, -0.95, 0.72, 0.05); x.closePath(); }); [[-0.2, -0.2], [0.18, -0.3], [0.3, -0.05], [-0.4, -0.02]].forEach(([a, b]) => line(c, "#d9d4c4", 0.05, (x) => { x.moveTo(a, b); x.lineTo(a + 0.1, b + 0.05); })); },
  cereal(c) { S(c, "#e8812f", rr(-0.5, -0.8, 1, 1.6, 0.08)); S(c, "#fff6e4", el(0, 0.05, 0.34, 0.3), 0.05); dot(c, "#e8b04a", -0.1, 0.0, 0.07); dot(c, "#e8b04a", 0.1, 0.1, 0.07); S(c, "#fbd36b", rr(-0.36, -0.62, 0.72, 0.2, 0.05), 0); },
  coffee(c) { c.save(); c.rotate(-0.6); S(c, "#6b4426", el(0, 0, 0.5, 0.78)); line(c, "#d9b48a", 0.07, (x) => { x.moveTo(0, -0.7); x.bezierCurveTo(0.3, -0.3, -0.3, 0.3, 0, 0.7); }); c.restore(); },
  honey(c) { S(c, "#e3a21a", rr(-0.5, -0.3, 1, 1.1, 0.24)); S(c, "#8a5a2b", rr(-0.54, -0.58, 1.08, 0.28, 0.07)); S(c, "#fff6e4", poly(-0.25, 0.1, 0.25, 0.1, 0.18, 0.5, -0.18, 0.5), 0.04); S(c, "#f6c24a", (x) => { x.moveTo(-0.3, -0.3); x.quadraticCurveTo(-0.3, 0, -0.18, 0); x.quadraticCurveTo(-0.06, 0, -0.06, -0.3); }, 0); },
  pizza(c) { S(c, "#f2b84b", poly(-0.7, -0.6, 0.7, -0.6, 0, 0.85)); S(c, "#d9843c", rr(-0.78, -0.76, 1.56, 0.24, 0.12)); dot(c, "#c63d3d", -0.2, -0.2, 0.15); dot(c, "#c63d3d", 0.25, -0.15, 0.13); dot(c, "#c63d3d", 0.02, 0.3, 0.12); },
  icecream(c) { S(c, "#d9a066", poly(-0.4, 0, 0.4, 0, 0, 0.95)); line(c, "#b9783e", 0.05, (x) => { x.moveTo(-0.22, 0.1); x.lineTo(0.14, 0.6); x.moveTo(0.22, 0.1); x.lineTo(-0.14, 0.6); }); S(c, "#f58bb8", el(0, -0.15, 0.5, 0.42)); S(c, "#fff0f6", el(0, -0.5, 0.36, 0.3)); dot(c, "#e0463a", 0.1, -0.84, 0.09); },
  pasta(c) { [0.85, 0.6, 0.35].forEach((r, i) => line(c, ["#f0c768", "#e6b24c", "#f0c768"][i], 0.17, (x) => x.ellipse(0, 0.05, r * 0.95, r * 0.7, 0, 0, 7))); dot(c, "#e0463a", 0.35, -0.25, 0.1); },
  butter(c) { S(c, "#f6e08a", rr(-0.8, -0.3, 1.6, 0.9, 0.12)); S(c, "#f8f1d6", poly(-0.8, -0.3, 0.1, -0.3, 0.1, 0.6, -0.8, 0.6), 0.06); line(c, "#e3c85a", 0.05, (x) => { x.moveTo(0.3, 0); x.lineTo(0.6, 0); x.moveTo(0.3, 0.2); x.lineTo(0.5, 0.2); }); },
  orange(c) { S(c, "#f08a24", el(0, 0.1, 0.72, 0.68)); S(c, "#3aa86f", el(0.2, -0.62, 0.3, 0.14, -0.4), 0.05); dot(c, "rgba(255,255,255,.5)", -0.3, -0.1, 0.1); },
  juice(c) { S(c, "#f08a24", poly(-0.5, -0.5, 0.5, -0.5, 0.38, 0.85, -0.38, 0.85)); S(c, "rgba(255,255,255,.55)", poly(-0.5, -0.5, 0.5, -0.5, 0.48, -0.3, -0.48, -0.3), 0); line(c, "#e0463a", 0.1, (x) => { x.moveTo(0.1, -0.5); x.lineTo(0.4, -0.95); }); },
  hummus(c) { S(c, "#e7e9f0", (x) => { x.moveTo(-0.85, -0.05); x.lineTo(0.85, -0.05); x.quadraticCurveTo(0.8, 0.8, 0, 0.8); x.quadraticCurveTo(-0.8, 0.8, -0.85, -0.05); }); S(c, "#e6c58a", el(0, -0.05, 0.72, 0.28)); dot(c, "#8aa83a", 0, -0.08, 0.1); line(c, "#c0462a", 0.05, (x) => x.arc(0, -0.05, 0.4, 0.3, 2.8)); },
  lemon(c) { c.save(); c.rotate(-0.4); S(c, "#f6e04a", (x) => { x.moveTo(-0.9, 0); x.quadraticCurveTo(-0.5, -0.65, 0.5, -0.55); x.lineTo(0.9, 0); x.lineTo(0.5, 0.55); x.quadraticCurveTo(-0.5, 0.65, -0.9, 0); }); dot(c, "rgba(255,255,255,.55)", -0.2, -0.2, 0.1); c.restore(); },
  apple(c) { S(c, "#d6404f", (x) => { x.moveTo(0, -0.35); x.bezierCurveTo(0.5, -0.8, 0.95, -0.1, 0.55, 0.55); x.bezierCurveTo(0.3, 0.9, 0.1, 0.7, 0, 0.7); x.bezierCurveTo(-0.1, 0.7, -0.3, 0.9, -0.55, 0.55); x.bezierCurveTo(-0.95, -0.1, -0.5, -0.8, 0, -0.35); }); line(c, INK, 0.07, (x) => { x.moveTo(0, -0.35); x.lineTo(0.05, -0.65); }); S(c, "#3aa86f", el(0.3, -0.62, 0.26, 0.12, -0.4), 0.05); dot(c, "rgba(255,255,255,.5)", -0.3, -0.1, 0.1); },
  tofu(c) { c.save(); c.rotate(-0.25); S(c, "#f6ecd2", rr(-0.6, -0.3, 1.2, 0.8, 0.12)); S(c, "#fff9e8", poly(-0.6, -0.3, 0.6, -0.3, 0.45, -0.55, -0.45, -0.55), 0.06); c.restore(); },
  flour(c) { S(c, "#fff", rr(-0.55, -0.7, 1.1, 1.5, 0.16)); S(c, "#e7e0cf", poly(-0.55, -0.7, 0.55, -0.7, 0.55, -0.5, -0.55, -0.5), 0); line(c, "#c9a14a", 0.07, (x) => { x.moveTo(0, 0.45); x.lineTo(0, -0.15); for (let i = 0; i < 3; i++) { x.moveTo(0, 0.1 - i * 0.17); x.quadraticCurveTo(-0.25, -0.02 - i * 0.17, -0.3, -0.12 - i * 0.17); x.moveTo(0, 0.1 - i * 0.17); x.quadraticCurveTo(0.25, -0.02 - i * 0.17, 0.3, -0.12 - i * 0.17); } }); },
  clean(c) { S(c, "#fff", rr(-0.6, -0.15, 1.2, 0.7, 0.2)); S(c, "#4f9be6", rr(-0.28, 0.0, 0.56, 0.4, 0.14), 0.05); dot(c, "#bfe2ff", -0.5, -0.5, 0.16); dot(c, "#bfe2ff", 0.1, -0.7, 0.11); dot(c, "#bfe2ff", 0.5, -0.4, 0.2); },
  cookie(c) { S(c, "#d9a05b", el(0, 0.05, 0.8, 0.8)); [[-0.3, -0.25], [0.28, -0.1], [-0.05, 0.35], [0.38, 0.4], [-0.45, 0.25]].forEach(([x, y]) => dot(c, "#5a3a22", x, y, 0.1)); },
  snow(c) { line(c, "#2ba6c4", 0.14, (x) => { for (let i = 0; i < 3; i++) { const a = (i / 3) * 3.1416; x.moveTo(Math.cos(a) * 0.8, Math.sin(a) * 0.8); x.lineTo(-Math.cos(a) * 0.8, -Math.sin(a) * 0.8); } }); },
  box(c) { S(c, "#c9a06a", rr(-0.7, -0.55, 1.4, 1.2, 0.1)); S(c, "#e0bf8a", poly(-0.7, -0.55, 0.7, -0.55, 0.55, -0.82, -0.55, -0.82), 0.06); line(c, "#a37e48", 0.06, (x) => { x.moveTo(0, -0.55); x.lineTo(0, 0.1); }); },
};

const RULES = [[/coffee|espresso/, "coffee"], [/baked beans|chickpea|kidney bean/, "can"], [/ice cream|gelato|sorbet/, "icecream"], [/milk|kefir|^(single |double )?cream$/, "milk"], [/egg/, "egg"], [/bread|loaf|sourdough|bun|roll|bagel|toast/, "bread"], [/banana/, "banana"], [/tomato/, "tomato"], [/spinach|lettuce|salad|kale|cabbage|leaf|herb|basil/, "leaf"],
  [/chicken|turkey|drum|thigh|wing|beef|pork|steak|mince|sausage|bacon|ham|lamb|meat/, "chicken"], [/salmon|fish|tuna|cod|prawn|shrimp|trout/, "fish"], [/cheese|cheddar|mozz|parmesan|feta/, "cheese"], [/yog|skyr|pot$/, "yoghurt"], [/peas?|bean|corn|broccoli|green/, "peas"],
  [/jam|marmalade|preserve|pickle|jar/, "jar"], [/chopped|canned|tin|soup|can$/, "can"], [/oil|vinegar|sauce|ketchup|wine/, "bottle"], [/rice|quinoa|couscous|oats$|lentil/, "rice"], [/cereal|muesli|granola|cornflake/, "cereal"], [/coffee|espresso/, "coffee"],
  [/honey|syrup/, "honey"], [/pizza/, "pizza"], [/ice cream|gelato|sorbet/, "icecream"], [/pasta|spaghetti|noodle|penne/, "pasta"], [/butter|margarine/, "butter"], [/orange juice|juice|smoothie/, "juice"], [/orange|mandarin|clementine/, "orange"],
  [/hummus|dip|pesto/, "hummus"], [/lemon|lime/, "lemon"], [/apple|pear|peach/, "apple"], [/tofu|tempeh/, "tofu"], [/flour|sugar|baking/, "flour"], [/dishwasher|tablet|detergent|soap|clean|sponge|bleach/, "clean"], [/fish finger|nugget/, "fish"], [/biscuit|cookie|crisps|chocolate|snack/, "cookie"]];
const BYCAT = { Meat: "chicken", Fish: "fish", Eggs: "egg", Dairy: "milk", Carbohydrates: "bread", Fruit: "apple", Vegetables: "leaf", Frozen: "snow", Pantry: "jar", Snacks: "cookie", Drinks: "bottle", Other: "box" };
const key = (name, cat) => { const n = String(name || "").toLowerCase(); for (const [re, k] of RULES) if (re.test(n)) return k; return BYCAT[cat] || "box"; };
const draw = (c, k, cx, cy, r) => { c.save(); c.translate(cx, cy); c.scale(r, r); (G[k] || G.box)(c); c.restore(); };
const cache = new Map();
/* a round sticker: light disc, the drawing, returned as a data URL for <img> */
const url = (name, cat) => {
  const k = key(name, cat); if (cache.has(k)) return cache.get(k);
  const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d");
  c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fillStyle = "#fffaf4"; c.fill();
  draw(c, k, 64, 66, 40); const u = cv.toDataURL("image/png"); cache.set(k, u); return u;
};
/* the shelf a drawing belongs to, so an ingredient with no stock row still gets a category colour */
const GLYPH_CAT = { milk: "Dairy", cheese: "Dairy", yoghurt: "Dairy", butter: "Dairy", egg: "Eggs", bread: "Carbohydrates", rice: "Carbohydrates", cereal: "Carbohydrates", pasta: "Carbohydrates", tomato: "Vegetables", leaf: "Vegetables", peas: "Vegetables", chicken: "Meat", fish: "Fish", jar: "Pantry", can: "Pantry", bottle: "Pantry", honey: "Pantry", flour: "Pantry", coffee: "Drinks", juice: "Drinks", pizza: "Frozen", icecream: "Frozen", banana: "Fruit", orange: "Fruit", lemon: "Fruit", apple: "Fruit", cookie: "Snacks" };
const category = (name) => GLYPH_CAT[key(name, "Other")] || "Other";
export const Glyph = { draw, key, url, category, keys: Object.keys(G) };
