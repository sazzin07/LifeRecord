import { useCallback, useMemo, useState } from "react";
import { Maximize2, Plus, RotateCcw, ShoppingCart, SlidersHorizontal, Trash2, X, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { api, eur } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Busy, ErrorBlock } from "@/components/skeletons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { locationOf } from "./shared";
import { Pill } from "./pills";
import { WIDGET_IDS, useGroceriesLayout } from "./useGroceriesLayout";
import { WidgetBoard } from "./todayBoard";
import { KIND_LOOK, WIDGETS, WIDGET_BODY, kindLook } from "./todayWidgets";
import { freshPercent } from "./ringMath";
import { CountUp, RingArcs, dayWords, daysOf, freshStats, plural, stepOf } from "./todayParts";
import { Welcome } from "./Welcome";
import { cookSummary } from "./kitchenMix";

const NEEDS = { needs: ["inventory"], kitchen: ["inventory", "locations"], list: ["shopping"], low: ["inventory"], risk: ["inventory"], cook: ["recipeIdeas"], week: ["inventory"] };
/** What an inventory row needs to be put back exactly as it was (the Undo of throwing food away). */
const restoreBody = (g) => ({ name: g.name, quantity: Number(g.quantity), unit: g.unit, category: g.category, storage_location: g.storage_location, expiration: g.expiration || null,
  price: g.price ?? null, store: g.store || null, low_threshold: Number(g.low_threshold) || 0, notes: g.notes || "", is_favorite: !!g.is_favorite });
const NEXT_SIZE = { s: "m", m: "l", l: "s" };
const SIZE_NAME = { s: "small", m: "medium", l: "large" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function TodaySkeleton({ widgets }) {
  // The real hero and cards with figure-sized placeholders, so nothing moves when the data arrives.
  const row = (i) => <div key={i} className="gt-row"><span className="gt-sticker sk-ph" style={{ width: 36, height: 36 }} /><div className="grow"><span className="name"><span className="sk-ph">Food name here</span></span><span className="gt-note"><span className="sk-ph">1 unit · Fridge</span></span></div></div>;
  return (
    <Busy label="Loading your kitchen"><div data-skeleton="" aria-hidden="true">
      <div className="gt-toolbar"><span className="gt-pill sk-ph" style={{ width: 520, height: 50 }} /><span className="gt-btn sk-ph">Customise</span></div>
      <div className="gt-hero">
        <div className="gt-hero-copy">
          <p className="gt-eyebrow"><span className="sk-ph">Good evening · Friday 6 November</span></p>
          <h2 className="gt-head"><span className="sk-ph">0 things need you today.</span></h2>
          <p className="gt-sub"><span className="sk-ph">Placeholder line about what is on a short clock.</span></p>
          <div className="gt-cta"><span className="gt-btn lg sk-ph">Cook something tonight</span></div>
        </div>
        <div className="gt-viz"><div className="gt-ring"><span className="sk-ph" style={{ display: "block", width: "100%", height: "100%", borderRadius: "50%" }} /></div></div>
        <dl className="gt-stats"><div><dt>In stock</dt><dd><span className="sk-ph">00</span></dd></div><div><dt>At risk</dt><dd><span className="sk-ph">€0.00</span></dd></div><div><dt>Worth</dt><dd><span className="sk-ph">€00.00</span></dd></div></dl>
      </div>
      <div className="gt-widgets">
        {widgets.map((w) => (
          <div key={w.id} className="gt-w" data-size={w.size}>
            <div className="gt-w-in"><div className="gt-card"><p className="gt-eyebrow"><span className="sk-ph">Widget title</span></p>{Array.from({ length: w.size === "s" ? 3 : 4 }, (_, i) => row(i))}</div></div>
          </div>
        ))}
      </div>
    </div></Busy>
  );
}

function Hero({ items, recipeIdeas, shopping, selectedListId, where, actions, setTab, onTrash }) {
  const st = freshStats(items);
  const n = st.gone.length + st.soon.length;
  const pct = freshPercent(st.fresh, st.live.length);
  const first = [...st.gone, ...st.soon].sort((a, b) => daysOf(a) - daysOf(b))[0];
  const pick = recipeIdeas[0];
  const toBuy = (shopping?.items || []).filter((i) => i.list_id === selectedListId && !i.selected).length;
  const head = !st.live.length ? "Nothing in here yet." : n === 0 ? "Everything is fresh." : n === 1 ? "One thing needs you today." : `${n} things need you today.`;
  const sub = !st.live.length ? "Add a food and this page starts watching it for you."
    : n === 0 ? "Nothing is about to go off. A calm kitchen, enjoy it."
      : `${eur(st.risk)} of food is on a short clock. Start with ${first.name.toLowerCase()}, ${dayWords(daysOf(first))}.`;
  const parts = [{ key: "gone", n: st.gone.length, color: "var(--gt-red)", label: "gone off" }, { key: "soon", n: st.soon.length, color: "var(--gt-amber)", label: "going off soon" }, { key: "fresh", n: st.fresh, color: "var(--gt-green)", label: "fresh" }];
  return (
    <section className="gt-hero" aria-label="Today at a glance">
      <div className="gt-hero-copy">
        <p className="gt-eyebrow">{greeting()} · {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}{where ? ` · ${where}` : ""}</p>
        <h2 className="gt-head">{head}</h2>
        <p className="gt-sub">{sub}</p>
        <div className="gt-cta">
          {pick && st.live.length > 0 && (pick.can_cook_now
            ? <button type="button" className="gt-btn cta lg" onClick={() => actions.cook(pick)}><ChefHat aria-hidden="true" />Cook {pick.recipe.name}</button>
            : <button type="button" className="gt-btn cta lg" onClick={() => actions.addMissing(pick)}><ShoppingCart aria-hidden="true" />Add {pick.missing.length} for {pick.recipe.name}</button>)}
          <button type="button" className="gt-btn lg" onClick={() => setTab("shopping")}><ShoppingCart aria-hidden="true" />{toBuy ? `${plural(toBuy, "item", "items")} to buy` : "Shopping list"}</button>
          {st.gone.length > 0 && <button type="button" className="gt-btn lg trash" onClick={() => onTrash(st.gone)}><Trash2 aria-hidden="true" />Throw away {st.gone.length === 1 ? "the expired item" : `${st.gone.length} expired`}</button>}
        </div>
      </div>
      <div className="gt-viz">
        <div className="gt-ring" role="img" aria-label={pct === null ? "Nothing in stock to measure" : `${pct} percent fresh: ${plural(st.fresh, "item", "items")} fresh, ${st.soon.length} going off soon, ${st.gone.length} gone off`}>
          <svg viewBox="0 0 128 128" aria-hidden="true"><circle className="gt-ring-track" cx="64" cy="64" r="52" /><RingArcs parts={parts} total={st.live.length} /></svg>
          <div className="gt-ring-mid"><b>{pct === null ? "—" : <CountUp value={pct} />}</b><span>{pct === null ? "nothing yet" : "% fresh"}</span></div>
        </div>
        <ul className="gt-key">{parts.map((p) => <li key={p.key}><i style={{ background: p.color }} /><b><CountUp value={p.n} /></b><span>{p.label}</span></li>)}</ul>
      </div>
      <dl className="gt-stats">
        <div><dt>In stock</dt><dd><CountUp value={st.live.length} /></dd></div>
        <div><dt>At risk</dt><dd><CountUp value={st.risk} format={eur} /></dd></div>
        <div><dt>Worth</dt><dd><CountUp value={st.value} format={eur} /></dd></div>
      </dl>
    </section>
  );
}

export function TodayTab({ inventory, locations, shopping, selectedListId, recipeIdeas, have = {}, failed = {}, onRetry, setTab, onAddToList, onOpenSpace }) {
  const { layout, ready, save, reset } = useGroceriesLayout();
  const [editing, setEditing] = useState(false);
  const [cookFor, setCookFor] = useState(null);
  const [trashFor, setTrashFor] = useState(null);   // the expired items waiting for a yes before they are thrown away
  const [said, setSaid] = useState("");
  const [welcoming, setWelcoming] = useState(false);   // the welcome stays on screen while it builds, even once the first space exists
  const focus = layout.focus !== "all" && locations.some((l) => l.id === layout.focus) ? layout.focus : "all";
  const items = useMemo(() => (focus === "all" ? inventory : inventory.filter((g) => locationOf(locations, g)?.id === focus)), [inventory, locations, focus]);
  const freezer = useMemo(() => locations.find((l) => l.kind === "freezer") || null, [locations]);
  const hidden = WIDGET_IDS.filter((id) => !layout.widgets.some((w) => w.id === id));

  // `undo` puts the change back: the message then carries an Undo button for a few seconds
  const act = useCallback(async (fn, ok, undo) => {
    try {
      await fn();
      if (ok) toast.success(ok, undo ? { duration: 8000, action: { label: "Undo", onClick: async () => { try { await undo(); refreshAll(); } catch { toast.error("Could not undo that"); } } } } : undefined);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "That did not work. Try again."); }
  }, []);
  const actions = useMemo(() => ({
    consume: (g) => act(() => api.post(`/groceries/${g.id}/consume`, { quantity: Math.min(stepOf(g.unit), Number(g.quantity)) }), `Used one ${g.name}`,
      () => api.put(`/groceries/${g.id}`, { quantity: Number(g.quantity) })),
    freeze: (g, f) => act(() => api.post(`/groceries/${g.id}/move`, { storage_location: f.name }), `Moved ${g.name} to ${f.name}`,
      g.storage_location ? () => api.post(`/groceries/${g.id}/move`, { storage_location: g.storage_location }) : undefined),
    discard: (g) => act(() => api.post(`/groceries/${g.id}/discard`, {}), `Threw away ${g.name}`, () => api.post("/groceries", restoreBody(g))),
    tick: (i) => act(() => api.post(`/shopping/${i.id}/toggle`)),
    cook: (e) => setCookFor(e),   // cooking uses up stock and logs a meal, so it asks first
    addMissing: (e) => act(() => api.post(`/recipes/${e.recipe.id}/add-missing`, { list_id: selectedListId || undefined }), `Added what ${e.recipe.name} needs to your list`),
  }), [act, selectedListId]);

  const throwAway = async () => {
    const gs = trashFor;
    setTrashFor(null);
    try {
      const done = [];
      for (const g of gs) { await api.post(`/groceries/${g.id}/discard`, {}); done.push(g); }
      toast.success(`Threw away ${plural(done.length, "expired item", "expired items")}`, { duration: 9000, action: { label: "Undo", onClick: async () => { try { for (const g of done) await api.post("/groceries", restoreBody(g)); refreshAll(); } catch { toast.error("Could not put them back"); } } } });
    } catch (err) { toast.error(err.response?.data?.detail || "Could not throw those away"); }
    refreshAll();
  };
  const cook = async () => {
    const e = cookFor;
    setCookFor(null);
    try {
      const { data } = await api.post(`/recipes/${e.recipe.id}/cook`);
      toast.success(`Cooked ${data.recipe}`, { description: data.inventory_changes.slice(0, 3).join(" · ") + (data.inventory_changes.length > 3 ? " …" : "") });
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not cook that recipe"); }
  };
  const setWidgets = (widgets) => save({ ...layout, widgets });
  const setFocus = (id) => save({ ...layout, focus: id });
  if (!(have.locations && have.inventory)) {
    return <div className="gt gt-fresh">{(failed.locations || failed.inventory) ? <ErrorBlock what="your kitchen" onRetry={onRetry} /> : <TodaySkeleton widgets={layout.widgets} />}</div>;
  }
  if (welcoming || (have.shopping && !locations.length && !inventory.length && !(shopping?.items || []).length)) {
    return <div className="gt gt-fresh"><Welcome onBuilding={() => setWelcoming(true)} onDone={() => { setWelcoming(false); refreshAll(); setTab("storage"); }} onFailed={() => setWelcoming(false)} /></div>;
  }

  const spaces = [{ id: "all", name: "Everywhere", kind: "all", n: inventory.length }, ...locations.map((l) => ({ ...l, n: inventory.filter((g) => locationOf(locations, g)?.id === l.id).length }))];
  const where = focus === "all" ? "" : locations.find((l) => l.id === focus)?.name || "";
  return (
    <div className="gt gt-fresh">
      <div className="gt-toolbar">
        <Pill role="group" aria-label="Show one space, or everywhere">
          {spaces.map((s) => {
            const Icon = s.kind === "all" ? KIND_LOOK.custom.icon : kindLook(s.kind).icon;
            return <button key={s.id} type="button" className="gt-pill-b" aria-pressed={focus === s.id} onClick={() => setFocus(s.id)}><Icon aria-hidden="true" /><span>{s.name}</span><b>{s.n}</b></button>;
          })}
        </Pill>
        <button type="button" className={cn("gt-btn", editing && "cta")} aria-pressed={editing} onClick={() => setEditing((v) => !v)}><SlidersHorizontal aria-hidden="true" /><span className="gt-lbl">{editing ? "Done" : "Customise"}</span></button>
      </div>

      {editing && (
        <div className="gt-card gt-tray">
          <span className="gt-note">Drag a widget by its handle to move it. {hidden.length ? "Add back:" : "Nothing hidden."}</span>
          {hidden.map((id) => <button key={id} type="button" className="gt-btn" onClick={() => setWidgets([...layout.widgets, { id, size: "m" }])}><Plus aria-hidden="true" />{WIDGETS[id].title}</button>)}
          <button type="button" className="gt-btn" onClick={reset}><RotateCcw aria-hidden="true" />Restore defaults</button>
        </div>
      )}

      <Hero items={items} recipeIdeas={recipeIdeas} shopping={shopping} selectedListId={selectedListId} where={where} actions={actions} setTab={setTab} onTrash={setTrashFor} />

      <WidgetBoard widgets={layout.widgets} editing={editing} onReorder={setWidgets} announce={setSaid}
        renderTile={(w, i, grip) => {
          const meta = WIDGETS[w.id], Body = WIDGET_BODY[w.id], Icon = meta.icon;
          const waiting = !NEEDS[w.id].every((k) => have[k]);
          const broke = NEEDS[w.id].some((k) => failed[k] && !have[k]);
          return (
            <>
              <div className="gt-w-tools">
                <span>{grip(meta.title)}</span>
                <span>
                  <button type="button" className="gt-btn" onClick={() => setWidgets(layout.widgets.map((x) => (x.id === w.id ? { ...x, size: NEXT_SIZE[x.size] } : x)))} aria-label={`Change size of ${meta.title}, now ${SIZE_NAME[w.size]}`}><Maximize2 aria-hidden="true" />{SIZE_NAME[w.size][0].toUpperCase() + SIZE_NAME[w.size].slice(1)}</button>
                  <button type="button" className="gt-btn icon" onClick={() => setWidgets(layout.widgets.filter((x) => x.id !== w.id))} aria-label={`Remove ${meta.title}`}><X aria-hidden="true" /></button>
                </span>
              </div>
              <section className="gt-card" aria-label={meta.title}>
                <p className="gt-eyebrow gt-w-h"><Icon aria-hidden="true" />{meta.title}</p>
                {broke ? <ErrorBlock what={meta.title.toLowerCase()} onRetry={onRetry} />
                  : waiting ? <div data-skeleton="" aria-hidden="true"><p><span className="sk-ph">A line of content here</span></p><p><span className="sk-ph">Another line of content</span></p></div>
                    : <Body items={items} inventory={inventory} locations={locations} freezer={freezer} shopping={shopping} selectedListId={selectedListId} recipeIdeas={recipeIdeas}
                      actions={actions} setTab={setTab} focus={focus} setFocus={setFocus} onAddToList={onAddToList} onOpenSpace={onOpenSpace} onTrash={setTrashFor} />}
              </section>
            </>
          );
        }} />
      {!layout.widgets.length && <div className="gt-card gt-empty"><strong>Everything is hidden</strong><button type="button" className="gt-btn cta" onClick={reset}>Restore defaults</button></div>}
      {!ready && <span className="sr-only" role="status">Loading your layout</span>}
      <span className="sr-only" role="status" aria-live="polite">{said}</span>
      <ConfirmDialog open={!!trashFor} onOpenChange={(v) => !v && setTrashFor(null)} title={trashFor?.length === 1 ? "Throw away this item?" : `Throw away ${trashFor?.length} expired items?`} confirmText="Throw away" variant="danger" onConfirm={throwAway}
        description={trashFor && `${trashFor.slice(0, 4).map((g) => g.name).join(", ")}${trashFor.length > 4 ? ` and ${trashFor.length - 4} more` : ""} · ${eur(trashFor.reduce((s, g) => s + (Number(g.price) || 0) * (Number(g.quantity) || 0), 0))} of food. You can undo it for a few seconds.`} />
      <ConfirmDialog open={!!cookFor} onOpenChange={(v) => !v && setCookFor(null)} title={`Cook ${cookFor?.recipe.name}?`} confirmText="Cook it" variant="primary" onConfirm={cook}
        description={cookFor && cookSummary(cookFor)} />
    </div>
  );
}
