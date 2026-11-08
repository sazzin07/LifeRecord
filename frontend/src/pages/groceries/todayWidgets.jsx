import { Archive, Check, ChefHat, ChevronRight, Clock, LayoutGrid, Package, Refrigerator, ShoppingCart, Snowflake, TriangleAlert, Plus } from "lucide-react";
import { eur } from "@/lib/api";
import { cn } from "@/lib/utils";
import { daysUntil, expiryLabel, locationOf, quantityText } from "./shared";
import { cookTimeLabel } from "./kitchenMix";
import { CountUp, CoverRing, Sticker, cap1, dayWords, daysOf, freshStats, needsYou, plural, qtyOf, stepOf, worth } from "./todayParts";

/** What each Today widget is called and which icon it carries. The ids are what the server stores (see layouts_api.py). */
export const WIDGETS = {
  needs: { title: "Needs you", icon: Clock },
  kitchen: { title: "Your kitchen", icon: LayoutGrid },
  list: { title: "Shopping list", icon: ShoppingCart },
  low: { title: "Running low", icon: TriangleAlert },
  risk: { title: "On a short clock", icon: Clock },
  cook: { title: "Cook with what you have", icon: ChefHat },
  week: { title: "Next 7 days", icon: Clock },
};

export const KIND_LOOK = {
  fridge: { icon: Refrigerator, u1: "#d9d3dc", u2: "#a99eb0" },
  freezer: { icon: Snowflake, u1: "#bfe3ee", u2: "#7fb8cc" },
  pantry: { icon: Package, u1: "#a8744a", u2: "#6e4527" },
  custom: { icon: Archive, u1: "#8c78a0", u2: "#5a4a70" },
};
export const kindLook = (k) => KIND_LOOK[k] || KIND_LOOK.custom;

const Empty = ({ title, text, children }) => <div className="gt-empty"><strong>{title}</strong><span className="gt-note">{text}</span>{children}</div>;

function Needs({ items, locations, freezer, actions }) {
  const rows = items.filter(needsYou).sort((a, b) => daysOf(a) - daysOf(b));
  if (!rows.length) return <Empty title="Nothing is about to go off" text="Everything here has more than three days left." />;
  return (
    <>
      <p className="gt-note">{plural(rows.length, "thing", "things")} · {eur(rows.reduce((s, g) => s + worth(g), 0))} at stake</p>
      <ul className="gt-list">
        {rows.slice(0, 6).map((g) => {
          const d = daysOf(g), tag = expiryLabel(g.expiration), inFridge = locationOf(locations, g)?.kind === "fridge";
          return (
            <li key={g.id} className={cn("gt-row gt-uf", d <= 0 && "red")}>
              <Sticker name={g.name} category={g.category} />
              <div className="grow"><span className="name">{g.name}</span><span className="gt-note">{quantityText(g.quantity, g.unit)} · {locationOf(locations, g)?.name || "Out on the counter"}</span></div>
              {tag && <span className={cn("gt-tag", tag.tone === "red" ? "red" : "amber")}>{tag.text}</span>}
              <span className="gt-uf-act">
                <button type="button" className="gt-btn" onClick={() => actions.consume(g)} aria-label={`Used one ${g.name}`}>Used one</button>
                {inFridge && freezer && <button type="button" className="gt-btn" onClick={() => actions.freeze(g, freezer)} aria-label={`Freeze ${g.name}`}><Snowflake aria-hidden="true" />Freeze</button>}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > 6 && <p className="gt-note">and {rows.length - 6} more in the kitchen</p>}
    </>
  );
}

function Kitchen({ inventory, locations, focus, setFocus, onOpenSpace }) {
  if (!locations.length) return <Empty title="No spaces yet" text="Add your fridge, freezer or pantry on the Storage tab." />;
  const counts = locations.map((l) => ({ l, its: inventory.filter((g) => locationOf(locations, g)?.id === l.id) }));
  const most = Math.max(1, ...counts.map((c) => c.its.length));
  return (
    <>
      <div className="gt-spaces">
        {counts.map(({ l, its }) => {
          const look = kindLook(l.kind), Icon = look.icon, attention = its.filter((g) => needsYou(g)).length, on = focus === l.id;
          return (
            <button key={l.id} type="button" className="gt-space" aria-pressed={on} onClick={() => setFocus(on ? "all" : l.id)} style={{ "--u1": look.u1, "--u2": look.u2 }}>
              <span className="gt-unit" aria-hidden="true"><Icon /></span>
              <span className="gt-space-txt">
                <strong><span className="sr-only">{on ? "Showing only " : "Focus on "}</span>{l.name}</strong>
                <span className="gt-note">{plural(its.length, "item", "items")}{attention > 0 && <> · <b className="warn">{attention} {attention === 1 ? "needs" : "need"} you</b></>}</span>
                <span className="gt-meter" aria-hidden="true"><i style={{ width: `${Math.round((its.length / most) * 100)}%` }} /></span>
              </span>
            </button>
          );
        })}
      </div>
      {focus !== "all" && onOpenSpace
        ? <button type="button" className="gt-btn" style={{ alignSelf: "flex-start", marginTop: "auto" }} onClick={() => onOpenSpace(focus)}>Open {locations.find((l) => l.id === focus)?.name} in Storage<ChevronRight aria-hidden="true" /></button>
        : <p className="gt-note" style={{ marginTop: "auto" }}>Tap a space to focus the whole page on it.</p>}
    </>
  );
}

function List({ shopping, selectedListId, actions, setTab }) {
  const rows = (shopping?.items || []).filter((i) => i.list_id === selectedListId);
  const todo = rows.filter((i) => !i.selected), inBasket = rows.length - todo.length;
  const summary = shopping?.budget_summary, total = rows.reduce((s, i) => s + (Number(i.estimated_price) || 0) * Number(i.quantity), 0);
  const budget = summary?.budget ?? null;
  return (
    <>
      <div className="gt-top">
        <div className="gt-big"><CountUp value={total} format={eur} /></div>
        <span className="gt-note">{todo.length} to get{inBasket ? ` · ${inBasket} in the basket` : ""}{budget !== null && <><br />Budget {eur(budget)}</>}</span>
      </div>
      {budget !== null && (
        <div className="gt-bar" role="progressbar" aria-valuenow={Math.round(total)} aria-valuemin={0} aria-valuemax={budget} aria-label="Spent against budget">
          <span className={total > budget ? "over" : total / budget > 0.8 ? "warn" : ""} style={{ width: `${Math.min(100, (total / budget) * 100)}%` }} />
        </div>
      )}
      {rows.length ? (
        <>
          <ul className="gt-list">
            {todo.slice(0, 4).map((i) => (
              <li key={i.id} className="gt-row">
                <input type="checkbox" className="h-5 w-5 accent-[var(--accent-ink)]" checked={false} onChange={() => actions.tick(i)} aria-label={`${i.name} in the basket`} />
                <Sticker name={i.name} category={i.category} size={32} />
                <span className="grow"><span className="name">{i.name}</span><span className="gt-note">{quantityText(i.quantity, i.unit)}</span></span>
                <span className="tabular-nums">{eur((Number(i.estimated_price) || 0) * Number(i.quantity))}</span>
              </li>
            ))}
          </ul>
          {todo.length > 4 && <p className="gt-note">and {todo.length - 4} more</p>}
        </>
      ) : <Empty title="Your list is empty" text="Add something running low, or open Shopping." />}
      <button type="button" className="gt-btn" style={{ alignSelf: "flex-start", marginTop: "auto" }} onClick={() => setTab("shopping")}><ShoppingCart aria-hidden="true" />Open shopping<ChevronRight aria-hidden="true" /></button>
    </>
  );
}

function Low({ items, shopping, onAddToList }) {
  const rows = items.filter((g) => Number(g.low_threshold) > 0 && qtyOf(g) <= Number(g.low_threshold));
  const on = new Set((shopping?.items || []).map((i) => i.name.toLowerCase()));
  if (!rows.length) return <Empty title="Stocked up" text="Nothing is under its low mark." />;
  return (
    <ul className="gt-list">
      {rows.map((g) => {
        const listed = on.has(g.name.toLowerCase());
        return (
          <li key={g.id} className="gt-row">
            <Sticker name={g.name} category={g.category} />
            <div className="grow"><span className="name">{g.name}</span><span className="gt-note">{quantityText(g.quantity, g.unit)} left</span></div>
            <button type="button" className="gt-btn" disabled={listed} onClick={() => onAddToList(g)}>
              {listed ? <><Check aria-hidden="true" />On list<span className="sr-only">: {g.name}</span></> : <><Plus aria-hidden="true" />Add<span className="sr-only"> {g.name} to the list</span></>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Risk({ items }) {
  const st = freshStats(items), pct = st.value ? Math.round((st.risk / st.value) * 100) : 0;
  const worst = [...st.gone, ...st.soon].sort((a, b) => worth(b) - worth(a)).slice(0, 3);
  return (
    <>
      <div className="gt-top" style={{ alignItems: "baseline", justifyContent: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div className={cn("gt-big gt-rk-big", st.risk > 0 && "hot")} style={{ fontSize: 40 }}><CountUp value={st.risk} format={eur} /></div>
        <span className="gt-note">of {eur(st.value)} in stock</span>
      </div>
      <div className="gt-rk-bar" role="img" aria-label={`${pct} percent of the value in stock is on a short clock`}><span style={{ width: `${pct}%` }} /></div>
      {worst.length ? (
        <>
          <ul className="gt-worst">{worst.map((g) => <li key={g.id}><Sticker name={g.name} category={g.category} size={32} /><span><strong className="text-[13px]">{g.name}</strong><span className="gt-note">{eur(worth(g))} · {dayWords(daysOf(g))}</span></span></li>)}</ul>
          <p className="gt-note">Cook these first.</p>
        </>
      ) : <p className="gt-note">Nothing in stock expires within three days.</p>}
    </>
  );
}

function Week({ items }) {
  const live = items.filter((g) => qtyOf(g) > 0 && g.expiration);
  const days = Array.from({ length: 7 }, (_, i) => live.filter((g) => { const d = daysUntil(g.expiration); return i === 0 ? d <= 0 : d === i; }));
  const top = Math.max(1, ...days.map((d) => d.length));
  const name = (i, style) => new Date(Date.now() + i * 864e5).toLocaleDateString(undefined, { weekday: style });
  return (
    <div className="gt-week" role="list" aria-label="What expires over the next seven days">
      {days.map((d, i) => (
        <div key={i} className={cn("gt-day", i === 0 && "now")} role="listitem" title={d.map((g) => g.name).join(", ")}
          aria-label={`${i === 0 ? "Today and earlier" : name(i, "long")}: ${d.length ? d.map((g) => g.name).join(", ") : "nothing expires"}`}>
          <span className="gt-col">
            <span className="gt-col-fill" style={{ "--h": `${Math.round((d.length / top) * 100)}%` }} />
            {d.slice(0, 3).map((g) => <Sticker key={g.id} name={g.name} category={g.category} size={24} />)}
            {d.length > 3 && <b className="relative z-[1] text-[11px] text-muted-foreground">+{d.length - 3}</b>}
          </span>
          <span className="gt-day-name">{i === 0 ? "Now" : name(i, "short")}</span>
        </div>
      ))}
    </div>
  );
}

function ingredientChips(e) {
  const miss = new Set((e.missing || []).map((m) => m.name.toLowerCase()));
  return (e.recipe.ingredients || []).map((ing) => {
    const out = miss.has(ing.name.toLowerCase());
    return <span key={ing.name} className={cn("gt-ing", out && "miss")}><Sticker name={ing.name} category="" size={20} /><span>{cap1(ing.name)}</span><span className="sr-only">{out ? ", missing" : ", in stock"}</span></span>;
  });
}

function Cook({ recipeIdeas, actions, setTab }) {
  const [top, ...rest] = recipeIdeas;
  if (!top) return <Empty title="No recipes yet" text="Add a recipe in Kitchen and it shows up here." />;
  const soon = top.uses_expiring?.[0];
  return (
    <div className="gt-cook">
      <h4 className="gt-cook-t">{top.recipe.name}</h4>
      <p className="gt-note">serves {top.recipe.servings}{cookTimeLabel(top.recipe.cook_minutes) ? ` · ${cookTimeLabel(top.recipe.cook_minutes)}` : ""}{top.recipe.calories ? ` · ${Math.round(top.recipe.calories / (top.recipe.servings || 1))} kcal each` : ""}{soon ? ` · uses ${soon.name.toLowerCase()} first` : ""}</p>
      <div className="gt-ings">{ingredientChips(top)}</div>
      <div className="flex flex-wrap gap-2">
        {top.can_cook_now
          ? <button type="button" className="gt-btn cta" onClick={() => actions.cook(top)}><ChefHat aria-hidden="true" />Cook this</button>
          : <button type="button" className="gt-btn" onClick={() => actions.addMissing(top)}><ShoppingCart aria-hidden="true" />Add {top.missing.length} to list</button>}
        <button type="button" className="gt-btn" onClick={() => setTab("kitchen")}>All recipes<ChevronRight aria-hidden="true" /></button>
      </div>
      {rest.length > 0 && (
        <ul className="gt-cook-next" aria-label="Next best recipes">
          {rest.slice(0, 2).map((e) => (
            <li key={e.recipe.id}><CoverRing pct={Math.round(e.coverage)} ready={e.can_cook_now} />
              <span className="grid leading-tight"><strong className="text-[13.5px]">{e.recipe.name}</strong><span className="gt-note">{e.can_cook_now ? "ready" : `${e.missing.length} missing`}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const WIDGET_BODY = { needs: Needs, kitchen: Kitchen, list: List, low: Low, risk: Risk, cook: Cook, week: Week };
