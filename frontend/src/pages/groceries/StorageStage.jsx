import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, LayoutGrid, Pencil, Plus, ShoppingCart, Snowflake, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { createKitchen3D } from "./kitchen3d";
import { adjustQuantity, moveItems, discardItems } from "./inventoryActions";
import { ELSEWHERE_ID, catOf, daysUntil, expiryLabel, isLow, needsAttention, quantityText } from "./shared";
import { Sticker, plural } from "./todayParts";
import { kindLook } from "./todayWidgets";

/* The Storage tab in 3D. The room (kitchen3d.js, three.js) draws the units and the food; everything you can read or press is real
   HTML around it: the plinth labels, the space chips, the caption and the side panel with every item, so nothing depends on the canvas. */
const toScene = (id) => (id === ELSEWHERE_ID ? "counter" : id);
const fromScene = (id) => (id === "counter" ? ELSEWHERE_ID : id);
const sceneKind = (kind) => ({ fridge: "fridge", freezer: "freezer", pantry: "pantry" }[kind] || "cupboard");
const TONE = { red: "red", amber: "amber", slate: "plain" };

function useDark() {
  const read = () => document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

const HELP = [
  "Click a handle (or any door or drawer) to open or shut it",
  "Double-click one to open or shut them all (the freezer opens one drawer at a time)",
  "Several units can stay open at once",
  "Hover a shelf item for its quantity, click it for its controls",
  "Drag an item onto another unit to move it; hover a shut drawer to open it",
  "Drag the empty room to look around, right-drag or Shift-drag to slide, double-click to reset",
  "To back out: click the empty room, scroll out, press the mouse Back button, or Esc",
  "Overview (or O) shows the whole kitchen; the arrows at the sides, or Shift and arrows, slide to the next unit",
  "With the pointer over the room: arrows look, the wheel or + and - zoom toward the pointer, 0 resets, comma and full stop change unit, Enter opens or shuts",
  "See-through fades the selected unit's doors so you can see inside",
];

function ItemCard({ g, units, current, listId, onClose, onEdit }) {
  const [asking, setAsking] = useState(false);
  const card = useRef(null);
  // Picking an item in the room opens this card under it; on a phone that is below the screen, so bring it into view (only if it is not already)
  useEffect(() => {
    const quiet = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card.current?.scrollIntoView({ block: "nearest", behavior: quiet ? "auto" : "smooth" });
  }, [g.id]);
  const exp = expiryLabel(g.expiration);
  const others = units.filter((u) => u.location && u.id !== current);
  const toList = async () => {
    try {
      await api.post("/shopping", { name: g.name, quantity: 1, unit: g.unit || "unit", category: g.category, list_id: listId || undefined });
      toast.success(`Added ${g.name} to your shopping list`);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not add to the list"); }
  };
  return (
    <section ref={card} className="gt-card gt-itemcard" aria-label={`${g.name} details`}>
      <div className="gt-itemcard-head">
        <Sticker name={g.name} category={catOf(g)} size={38} />
        <div className="min-w-0">
          <h3>{g.name}</h3>
          <p className="gt-note">{catOf(g)}{g.storage_location ? ` in ${g.storage_location}` : ""}</p>
        </div>
      </div>
      <div className="gt-tags">
        {exp && <span className={cn("gt-tag", TONE[exp.tone])}>{exp.text}</span>}
        {isLow(g) && <span className="gt-tag amber"><TriangleAlert aria-hidden="true" />Running low</span>}
      </div>
      <div className="gt-stepper">
        <button type="button" className="gt-btn icon" onClick={() => adjustQuantity(g, -1)} disabled={Number(g.quantity) <= 0} aria-label={`Use one ${g.name}`}>−</button>
        <b aria-live="polite">{quantityText(g.quantity, g.unit)}</b>
        <button type="button" className="gt-btn icon" onClick={() => adjustQuantity(g, 1)} aria-label={`Add one ${g.name}`}>+</button>
      </div>
      {others.length > 0 && (
        <>
          <p className="gt-eyebrow">Move to</p>
          <div className="gt-tags">
            {others.map((u) => (
              <button key={u.id} type="button" className="gt-btn" onClick={() => moveItems([g.id], u.name)}>
                {u.kind === "freezer" && <Snowflake aria-hidden="true" />}{u.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="gt-tags">
        <button type="button" className="gt-btn" onClick={toList}><ShoppingCart aria-hidden="true" />Add to list</button>
        <button type="button" className="gt-btn" onClick={() => onEdit(g)}><Pencil aria-hidden="true" />Edit</button>
        <button type="button" className="gt-btn" onClick={() => setAsking(true)}><Trash2 aria-hidden="true" />Discard</button>
        <button type="button" className="gt-btn" onClick={onClose}>Close</button>
      </div>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Discard from inventory?"
        description={`This removes ${g.name} from your inventory. Use the − button instead if you just ate or used some.`}
        onConfirm={async () => { if (await discardItems([g.id])) { setAsking(false); onClose(); } }}
        confirmText="Discard"
        variant="danger"
      />
    </section>
  );
}

function SpaceList({ unit, selId, onPick }) {
  const items = [...unit.items].sort((a, b) => (daysUntil(a.expiration) ?? 9999) - (daysUntil(b.expiration) ?? 9999) || a.name.localeCompare(b.name));
  return (
    <section className="gt-card" aria-label={`Everything ${unit.id === ELSEWHERE_ID ? "on the counter" : `in ${unit.name}`}`}>
      <p className="gt-eyebrow">{unit.id === ELSEWHERE_ID ? "On the counter" : `In ${unit.name}`}</p>
      {items.length ? (
        <ul className="gt-list">
          {items.map((g) => {
            const exp = expiryLabel(g.expiration);
            return (
              <li key={g.id} data-testid="storage-item-row">
                <button type="button" className={cn("gt-row", selId === g.id && "on")} aria-pressed={selId === g.id} onClick={() => onPick(g.id)}>
                  <Sticker name={g.name} category={catOf(g)} size={36} />
                  <span className="grow"><span className="name">{g.name}</span><span className="gt-note">{quantityText(g.quantity, g.unit)}</span></span>
                  {exp && <span className={cn("gt-tag", TONE[exp.tone])}>{exp.text}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="gt-empty"><strong>Nothing in here yet</strong><span className="gt-note">Add a food and it lands on a shelf.</span></div>
      )}
    </section>
  );
}

function Overview({ units, onOpen }) {
  return (
    <section className="gt-card" aria-label="All spaces">
      <p className="gt-eyebrow">Open a unit</p>
      <ul className="gt-list">
        {units.map((u) => {
          const a = u.items.filter(needsAttention).length;
          const look = kindLook(u.kind);
          return (
            <li key={u.id}>
              <button type="button" className="gt-row" onClick={() => onOpen(u.id)}>
                <span className="gt-unit" style={{ "--u1": look.u1, "--u2": look.u2 }} aria-hidden="true"><look.icon /></span>
                <span className="grow"><span className="name">{u.name}</span><span className="gt-note">{plural(u.items.length, "item", "items")}{a > 0 && <> · <b className="warn">{a} need{a === 1 ? "s" : ""} attention</b></>}</span></span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function StorageStage({ units, selectedId, onSelect, detailsOpen, onToggleDetails, onEditItem, onAddItem, onFailed, onSlow, noProbe, selectedListId }) {
  const hostRef = useRef(null);
  const wrapRef = useRef(null);
  const tagRef = useRef(null);
  const kRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [, setRev] = useState(0);                 // the room tells us when a door, a drawer or the view changed
  const [sel, setSel] = useState(null);           // the item chosen in the room or in the list
  const [xray, setXray] = useState(true);
  const [help, setHelp] = useState(false);
  const [tip, setTip] = useState(null);
  const dark = useDark();
  const fromRoom = useRef(false);
  const viewSet = useRef(false);

  const cur = units.find((u) => u.id === selectedId) || null;
  const curScene = cur ? toScene(cur.id) : null;
  const byId = useMemo(() => new Map(units.flatMap((u) => u.items.map((g) => [g.id, g]))), [units]);
  const selItem = sel != null && cur && cur.items.some((g) => g.id === sel) ? byId.get(sel) : null;

  const spaces = useMemo(() => units.filter((u) => u.id !== ELSEWHERE_ID).map((u) => ({ id: u.id, kind: sceneKind(u.kind), name: u.name })), [units]);
  const hasCounter = units.some((u) => u.id === ELSEWHERE_ID);
  const items = useMemo(() => units.flatMap((u) => u.items.map((g) => ({
    id: g.id, name: g.name, qty: Number(g.quantity) || 0, unit: g.unit || "unit", cat: catOf(g),
    loc: u.id === ELSEWHERE_ID ? null : u.id, d: daysUntil(g.expiration), low: isLow(g),
  }))), [units]);

  // Handlers read the latest props through a ref, so the room is created once and never rebuilt for a re-render.
  const live = useRef({});
  live.current = { units, selectedId, onSelect, byId, help, selItem, onFailed, onSlow, noProbe, onAddItem };

  const toggleUnit = useCallback((pageId) => {
    const L = live.current, k = kRef.current; if (!k) return;
    const sid = toScene(pageId), open = k.isOpen(sid);
    // open and in the main view: step into it; open elsewhere: close it; shut: open it
    if (k.isOverview() && open && !fromRoom.current) { L.onSelect(pageId); k.setOverview(false); }
    else if (open) L.onSelect(L.selectedId === pageId ? null : pageId);
    else { L.onSelect(pageId); k.open(sid); }
    setSel(null);
    setRev((r) => r + 1);
  }, []);

  const startDrag = useCallback(({ id, x, y }) => {
    const L = live.current, k = kRef.current, g = L.byId.get(id), tag = tagRef.current; if (!k || !g || !tag) return;
    setTip(null);
    const home = L.units.find((u) => u.items.some((i) => i.id === id));
    const byKey = new Map(L.units.map((u) => [String(toScene(u.id)), u]));
    let target = null;
    const place = (cx, cy) => { tag.style.transform = `translate(${cx + 18}px, ${cy + 28}px)`; };
    const overChip = (cx, cy) => document.elementsFromPoint(cx, cy).find((n) => n.classList && n.classList.contains("gt-chip") && n.dataset.space != null);
    tag.hidden = false; tag.textContent = g.name; place(x, y); document.body.style.userSelect = "none";
    const move = (e) => {
      place(e.clientX, e.clientY);
      document.querySelectorAll(".gt-chip.over").forEach((c) => c.classList.remove("over"));
      const chip = overChip(e.clientX, e.clientY); if (chip) chip.classList.add("over");
      const t3 = k.dragOver(e.clientX, e.clientY);
      const key = chip ? chip.dataset.space : t3 != null ? String(t3) : null;
      target = key != null ? byKey.get(key) || null : null;
      const ok = target && target.id !== ELSEWHERE_ID && target.id !== (home && home.id);
      tag.textContent = ok ? `Move to ${target.name}` : g.name;
    };
    const finish = (dropped) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      tag.hidden = true; document.body.style.userSelect = "";
      document.querySelectorAll(".gt-chip.over").forEach((c) => c.classList.remove("over"));
      const ok = dropped && target && target.id !== ELSEWHERE_ID && target.id !== (home && home.id);
      k.endDrag(id, !!ok);
      if (ok) moveItems([id], target.name);
    };
    const up = () => finish(true), cancel = () => finish(false);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
  }, []);

  // Create the room once, wire its events to the page, tear it down with the tab.
  useEffect(() => {
    let k;
    try { k = createKitchen3D(); k.attach(hostRef.current); } catch { if (k) k.dispose(); live.current.onFailed(); return undefined; }
    kRef.current = k; hostRef.current.__k3d = k;
    const place = (d, dx, dy) => { const w = wrapRef.current.getBoundingClientRect(); return { left: Math.max(8, Math.min(w.width - 190, d.x - w.left - dx)), top: Math.max(8, d.y - w.top - dy) }; };
    k.on("pick", (d) => {   // an item in another open unit brings that unit into focus
      const home = d.id != null && live.current.units.find((u) => u.items.some((g) => g.id === d.id));
      if (home && home.id !== live.current.selectedId) live.current.onSelect(home.id);
      setSel(d.id);
    });
    k.on("space", (d) => { fromRoom.current = !!d.keep; toggleUnit(fromScene(d.id)); });
    k.on("focus", (d) => { live.current.onSelect(fromScene(d.id)); setSel(null); });
    k.on("parts", () => setRev((r) => r + 1));
    k.on("view", () => setRev((r) => r + 1));
    k.on("failed", () => live.current.onFailed());
    k.on("slow", () => { if (!live.current.noProbe) live.current.onSlow(); });
    k.on("dragstart", startDrag);
    k.on("hover", (d) => { const g = d && live.current.byId.get(d.id); setTip(g ? { ...place(d, 80, 50), g } : null); });
    k.on("parthint", (d) => setTip(d ? { ...place(d, 60, 44), part: d } : null));
    if (document.fonts && document.fonts.load) document.fonts.load('800 36px "Plus Jakarta Sans"').then(() => kRef.current && kRef.current.refreshItems()).catch(() => {});
    setReady(true);
    return () => { kRef.current = null; setReady(false); k.dispose(); };
  }, [toggleUnit, startDrag]);

  // Keep the room in step with the page: spaces, food, theme, the chosen item and the open unit.
  useEffect(() => {
    const k = kRef.current; if (!k || !ready) return;
    k.sync({ spaces, items, theme: dark ? "dark" : "light", sel: selItem ? selItem.id : null, hasCounter });
    if (curScene !== k.openId()) {
      if (curScene != null && k.isOpen(curScene)) k.focus(curScene, fromRoom.current);
      else k.open(curScene, fromRoom.current);
    }
    fromRoom.current = false;
    k.setXray(xray);
    if (!viewSet.current) { viewSet.current = true; if (!cur) k.setOverview(true); }   // the first view is the whole kitchen, unless you came here for one space
    setRev((r) => r + 1);
  }, [ready, spaces, items, dark, selItem, hasCounter, curScene, xray, cur]);

  // A chosen item stays chosen only while it is still in the open unit (moved, discarded or another unit opened: it lets go).
  useEffect(() => { setSel((s) => (s != null && cur && cur.items.some((g) => g.id === s) ? s : null)); }, [cur]);

  // Escape backs out one step: tips, the chosen item, the zoomed view, then the open unit.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"]:not(.gt-help),[role="alertdialog"],[data-radix-popper-content-wrapper]')) return;
      const L = live.current, k = kRef.current; if (!k) return;
      if (L.help) setHelp(false);
      else if (L.selItem) setSel(null);
      else if (!k.isOverview()) k.setOverview(true);
      else if (L.selectedId != null) L.onSelect(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const k = kRef.current;
  const overview = !!k && k.isOverview();
  const openCount = k ? k.openCount() : 0;
  const isOpen = (u) => !!k && k.isOpen(toScene(u.id));
  const curOpen = !!cur && isOpen(cur);
  const att = units.reduce((n, u) => n + u.items.filter(needsAttention).length, 0);
  const total = units.reduce((n, u) => n + u.items.length, 0);

  let capacity = null;
  if (cur && k) {
    const st = k.stat(curScene), n = cur.items.length;
    const lit = Math.max(n ? 1 : 0, Math.min(10, Math.round((st.placed / st.cap) * 10)));
    const word = st.over ? `full, ${st.over} not shown here` : n === 0 ? "empty" : lit >= 9 ? "very full" : lit >= 6 ? "fairly full" : lit >= 3 ? "room to spare" : "plenty of room";
    capacity = { lit, word };
  }
  const parts = cur && k ? k.parts(curScene) : null;
  const toggleCurrent = () => { if (cur) toggleUnit(cur.id); };

  return (
    <div className="gt-stage">
      <section ref={wrapRef} className="gt-scene" aria-label="Kitchen storage">
        <div ref={hostRef} className="gt-k3d" data-k3d="" data-view={overview ? "overview" : "unit"} data-open={cur ? cur.name : ""} tabIndex={0} role="group"
          aria-label="3D kitchen. Click or Tab to it, then arrow keys look around, plus and minus zoom, zero resets the view, comma and full stop switch unit, Enter opens or shuts the unit." />
        {cur && k && !overview && (
          <>
            <button type="button" className="gt-btn icon gt-slide l" onClick={() => k.slide(-1)} aria-label="Look left, to the next unit"><ChevronLeft aria-hidden="true" /></button>
            <button type="button" className="gt-btn icon gt-slide r" onClick={() => k.slide(1)} aria-label="Look right, to the next unit"><ChevronRight aria-hidden="true" /></button>
          </>
        )}
        <div className="gt-chipbar" role="group" aria-label="Spaces. Press the open one to close it. Drop an item on one to move it there.">
          {units.map((u) => (
            <button key={u.id} type="button" className="gt-chip" data-space={toScene(u.id)} aria-pressed={!!cur && u.id === cur.id}
              data-open={isOpen(u) && !(cur && u.id === cur.id) ? "1" : undefined} onClick={() => { fromRoom.current = false; toggleUnit(u.id); }}>
              {u.name}<b>{u.items.length}</b>
            </button>
          ))}
          <button type="button" className="gt-chip gt-ovbtn" aria-pressed={overview} onClick={() => k && k.setOverview(true)}><LayoutGrid aria-hidden="true" />Overview</button>
          <button type="button" className="gt-chip gt-helpbtn" aria-expanded={help} aria-controls="gt-help" onClick={() => setHelp((v) => !v)}>
            <CircleHelp aria-hidden="true" /><span className="sr-only">Tips for the room</span>
          </button>
        </div>
        {help && (
          <div className="gt-help" id="gt-help" role="dialog" aria-label="Around the room">
            <div className="gt-help-h"><strong>Around the room</strong><button type="button" className="gt-btn icon" onClick={() => setHelp(false)} aria-label="Close tips"><X aria-hidden="true" /></button></div>
            <ul className="gt-hints">{HELP.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        )}
        {cur && cur.items.length === 0 && (
          <div className="gt-k3d-empty" role="status">
            <span><strong>Empty for now</strong><small>Add a food and it lands on a shelf.</small></span>
            <button type="button" className="gt-btn cta" onClick={() => onAddItem(cur.location ? cur.location.name : undefined)}><Plus aria-hidden="true" />Add food</button>
          </div>
        )}
        <div className="gt-cap">
          {cur ? (
            <>
              <div><strong>{cur.name}</strong> <span className="gt-note">{plural(cur.items.length, "item", "items")} · {cur.items.filter(needsAttention).length} need attention</span></div>
              <div className="gt-cap-r">
                <span className="gt-fill" role="img" aria-label={capacity ? capacity.word : ""}>{Array.from({ length: 10 }, (_, i) => <i key={i} className={capacity && i < capacity.lit ? "on" : ""} />)}</span>
                <span className="gt-note">{capacity && capacity.word}</span>
                {parts && parts.n > 0 && (
                  parts.exclusive || parts.n === 1 ? (
                    <>
                      {parts.exclusive && <span className="gt-note">{parts.open ? "1 drawer open" : "all drawers shut"} · one at a time</span>}
                      <button type="button" className="gt-chip" onClick={toggleCurrent}>{parts.open ? "Close" : "Open"} {cur.name}</button>
                    </>
                  ) : (
                    <>
                      <span className="gt-note">{parts.open} of {parts.n} {parts.kind}s open</span>
                      {parts.open === parts.n
                        ? <button type="button" className="gt-chip" onClick={toggleCurrent}>Close all {parts.n} {parts.kind}s</button>
                        : <button type="button" className="gt-chip" onClick={() => { k.openUnit(curScene); setRev((r) => r + 1); }}>Open all {parts.n} {parts.kind}s</button>}
                    </>
                  )
                )}
                <button type="button" className="gt-chip" onClick={() => onAddItem(cur.location ? cur.location.name : undefined)}><Plus aria-hidden="true" />Add food</button>
                <button type="button" className="gt-chip" aria-pressed={xray} onClick={() => setXray((v) => !v)}>See-through</button>
                {openCount > (curOpen ? 1 : 0) && <button type="button" className="gt-chip" onClick={() => { k.closeAll(); onSelect(null); setSel(null); setRev((r) => r + 1); }}>Close all</button>}
                <button type="button" className="gt-chip" aria-expanded={detailsOpen} onClick={onToggleDetails}>
                  {detailsOpen ? <>Hide details<ChevronUp aria-hidden="true" /></> : <>More details<ChevronDown aria-hidden="true" /></>}
                </button>
              </div>
            </>
          ) : (
            <>
              <div><strong>Your kitchen</strong> <span className="gt-note">{plural(units.length, "space", "spaces")} · {plural(total, "item", "items")} · {att} need attention</span></div>
              <span className="gt-cap-r">
                <span className="gt-note">{openCount ? `${openCount} open. Click any door or drawer to shut it.` : "Everything is closed. Click a unit, a door or a drawer."}</span>
                {openCount > 0 && <button type="button" className="gt-chip" onClick={() => { k.closeAll(); onSelect(null); setSel(null); setRev((r) => r + 1); }}>Close all</button>}
              </span>
            </>
          )}
        </div>
        <div className={cn("gt-tip", tip && "on")} role="presentation" style={tip ? { left: tip.left, top: tip.top } : undefined}>
          {tip && tip.g && <><b>{tip.g.name}<span className="q">{quantityText(tip.g.quantity, tip.g.unit)}</span></b><span className="gt-note">{catOf(tip.g)}{expiryLabel(tip.g.expiration) ? ` · ${expiryLabel(tip.g.expiration).text}` : ""}{isLow(tip.g) ? " · running low" : ""}</span></>}
          {tip && tip.part && <><b>{tip.part.text}</b>{tip.part.sub && <span className="gt-note">{tip.part.sub}</span>}</>}
        </div>
        <div ref={tagRef} className="gt-dragtag" hidden />
      </section>
      <div className="gt-side">
        <p className="sr-only" role="status">{cur ? `${cur.name} ${curOpen ? "open" : "shut"}, ${plural(cur.items.length, "item", "items")}` : `Showing all storage spaces, ${plural(units.length, "space", "spaces")}`}</p>
        {selItem && <ItemCard g={selItem} units={units} current={cur && cur.id} listId={selectedListId} onClose={() => setSel(null)} onEdit={onEditItem} />}
        {cur ? <SpaceList unit={cur} selId={selItem ? selItem.id : null} onPick={setSel} /> : <Overview units={units} onOpen={(id) => { fromRoom.current = false; toggleUnit(id); }} />}
      </div>
    </div>
  );
}
