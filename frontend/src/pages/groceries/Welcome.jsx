import { useEffect, useRef, useState } from "react";
import { Check, ChefHat, Leaf, ShoppingCart, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Sticker, plural } from "./todayParts";
import { kindLook } from "./todayWidgets";

/* The first screen of a new account: pick where food lives, then watch the spaces being built while they are really created. */
const PRESETS = [
  { name: "Fridge", kind: "fridge", blurb: "Dairy, meat, leftovers" },
  { name: "Freezer", kind: "freezer", blurb: "Frozen food, drawer by drawer" },
  { name: "Pantry", kind: "pantry", blurb: "Dry goods, tins, snacks" },
  { name: "Cupboard", kind: "custom", blurb: "Spices, cleaning, the rest" },
];
const FLOATING = [["Whole milk", "Dairy"], ["Tomatoes", "Vegetables"], ["Sourdough loaf", "Carbohydrates"], ["Free-range eggs", "Eggs"], ["Salmon fillets", "Fish"], ["Lemons", "Fruit"], ["Cheddar", "Dairy"], ["Coffee beans", "Drinks"]];
const FLOAT_AT = [[46, 5, -12], [93, 5, 8], [49, 38, -6], [94, 46, 14], [46, 80, 6], [93, 82, -10], [68, 90, 12], [70, -3, -8]];
const STEPS = ["Measuring the shelves", "Hanging the doors", "Switching on the lights"];
const HOOKS = [[Leaf, "Waste less", "Get a nudge before food goes off"], [ChefHat, "Cook what you own", "Recipes matched to your shelves"], [ShoppingCart, "Shop once", "A list that knows what is missing"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Welcome({ onBuilding, onDone, onFailed }) {
  const [chosen, setChosen] = useState(() => new Set(PRESETS.map((_, i) => i)));
  const [custom, setCustom] = useState("");
  const [customKind, setCustomKind] = useState("custom");
  const [building, setBuilding] = useState(null);
  const root = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const extra = custom.trim();
  const count = chosen.size + (extra ? 1 : 0);
  const toggle = (i) => setChosen((c) => { const n = new Set(c); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const build = async (e) => {
    e.preventDefault();
    if (building) return;
    const spaces = [...PRESETS.filter((_, i) => chosen.has(i)).map((p) => ({ name: p.name, kind: p.kind })), ...(extra ? [{ name: extra, kind: customKind }] : [])];
    if (!spaces.length) { toast.error("Pick at least one space, or add your own."); return; }
    setBuilding(spaces);
    onBuilding();
    const started = Date.now(), minimum = reduced() ? 250 : 900 + spaces.length * 650 + 700;
    try {
      for (let i = 0; i < spaces.length; i += 1) await api.post("/storage-locations", { name: spaces[i].name, kind: spaces[i].kind, sort_order: i });
      await sleep(Math.max(0, minimum - (Date.now() - started)));
      if (!reduced() && root.current?.animate) await root.current.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.985) translateY(-8px)" }], { duration: 380, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }).finished.catch(() => {});
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not build your kitchen. Nothing is lost: try again.");
      if (alive.current) setBuilding(null);
      onFailed();
      refreshAll();   // some spaces may already exist: the page shows whatever was really created
    }
  };

  const total = building ? 900 + building.length * 650 + 700 : 0;
  return (
    <section ref={root} className={`gt-wel ${building ? "building" : ""}`} aria-label="Set up your kitchen">
      <div className="gt-sky" aria-hidden="true">
        {FLOATING.map(([n, c], i) => <span key={n} className="gt-float" style={{ left: `${FLOAT_AT[i][0]}%`, top: `${FLOAT_AT[i][1]}%`, "--r": `${FLOAT_AT[i][2]}deg`, animationDelay: `${-i}s` }}><Sticker name={n} category={c} size={64} /></span>)}
      </div>
      <div className="gt-wel-copy">
        <p className="gt-eyebrow gt-wel-eyebrow"><Sparkles aria-hidden="true" />Welcome to your kitchen</p>
        <h2 className="gt-wel-head">Know what you have<br />before you open the fridge.</h2>
        <p className="gt-sub">Tell us where you keep food. We will watch the dates, remind you before anything goes off, and suggest what to cook with it.</p>
        <ul className="gt-hooks">{HOOKS.map(([Icon, t, s]) => <li key={t}><b><Icon aria-hidden="true" /></b><span><strong>{t}</strong>{s}</span></li>)}</ul>
      </div>

      {building ? (
        <div className="gt-panel" role="status" aria-live="polite" style={{ "--total": `${total}ms` }}>
          <p className="gt-build-t"><Sparkles aria-hidden="true" />Building your kitchen</p>
          <ul className="gt-build-list">
            {building.map((s, i) => {
              const look = kindLook(s.kind), Icon = look.icon;
              return (
                <li key={s.name + i} style={{ "--i": i, "--u1": look.u1, "--u2": look.u2 }}>
                  <span className="gt-unit" aria-hidden="true"><Icon /></span><strong>{s.name}</strong>
                  <span className="gt-stat" aria-hidden="true"><i className="gt-spin" /><span className="gt-done"><Check /></span></span>
                </li>
              );
            })}
          </ul>
          <div className="gt-progress" aria-hidden="true"><span /></div>
          <p className="gt-tips" aria-hidden="true">{STEPS.map((t, k) => <span key={t} style={{ "--k": k }}>{t}</span>)}</p>
        </div>
      ) : (
        <form className="gt-panel" onSubmit={build} aria-label="Choose your spaces">
          <p className="gt-step"><span>1</span>Pick the places you keep food</p>
          <div className="gt-choices">
            {PRESETS.map((p, i) => {
              const look = kindLook(p.kind), Icon = look.icon;
              return (
                <label key={p.name} className="gt-choice" style={{ "--u1": look.u1, "--u2": look.u2, "--i": i }}>
                  <input type="checkbox" checked={chosen.has(i)} onChange={() => toggle(i)} />
                  <span className="gt-unit" aria-hidden="true"><Icon /></span>
                  <span className="gt-choice-txt"><strong>{p.name}</strong><span className="gt-note">{p.blurb}</span></span>
                  <span className="gt-choice-tick" aria-hidden="true"><Check /></span>
                </label>
              );
            })}
          </div>
          <div className="gt-extra">
            <input className="gt-input" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={80} placeholder="Another space, like a garage fridge" aria-label="Another space" />
            <select className="gt-input" value={customKind} onChange={(e) => setCustomKind(e.target.value)} aria-label="What kind of space">
              <option value="fridge">Fridge</option><option value="freezer">Freezer</option><option value="pantry">Pantry</option><option value="custom">Cupboard</option>
            </select>
          </div>
          <button type="submit" className="gt-btn cta lg" style={{ minHeight: 52, fontSize: 15 }}><Sparkles aria-hidden="true" />Build my kitchen</button>
          <p className="gt-note" style={{ textAlign: "center" }} aria-live="polite">{count ? `${plural(count, "space", "spaces")} chosen. You can rename, add or remove them later.` : "Pick at least one space, or add your own below."}</p>
        </form>
      )}
    </section>
  );
}
