import { useMemo } from "react";
import { ArrowRight, Check, ChefHat, Clock, Plus, Refrigerator, ShoppingCart, TrendingDown, Wallet } from "lucide-react";
import { Card, EmptyState } from "@/components/common";
import { eur } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CatIcon, daysUntil, expiryLabel, locationOf, quantityText } from "./shared";

const TONES = {
  red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
};

function Stat({ icon: Icon, label, value, tone, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone || "bg-accent text-accent-foreground")}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block stat-num text-xl font-extrabold leading-none">{value}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </button>
  );
}

function Section({ title, sub, children, action }) {
  return (
    <Card className="p-4 md:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function OverviewTab({ inventory, locations, lowStock, shopping, recipeIdeas = [], onOpenSpace, onAddToList, setTab }) {
  const useSoon = useMemo(
    () => inventory
      .filter((g) => Number(g.quantity) > 0 && (daysUntil(g.expiration) ?? 99) <= 7)
      .sort((a, b) => a.expiration.localeCompare(b.expiration)),
    [inventory],
  );
  const onList = useMemo(() => new Set((shopping?.items || []).map((i) => i.name.toLowerCase())), [shopping]);
  const activeLists = (shopping?.lists || []).filter((l) => !l.archived).length;
  const urgent = useSoon.filter((g) => daysUntil(g.expiration) <= 3).length;

  // Only count items with a known price, and say how much of the stock that covers.
  const money = useMemo(() => {
    const stocked = inventory.filter((g) => Number(g.quantity) > 0);
    const priced = stocked.filter((g) => Number(g.price) > 0);
    const value = (rows) => rows.reduce((sum, g) => sum + Number(g.price) * Number(g.quantity), 0);
    return {
      total: value(priced), covered: priced.length, of: stocked.length,
      atRisk: value(priced.filter((g) => (daysUntil(g.expiration) ?? 99) <= 3)),
      reliable: stocked.length > 0 && priced.length / stocked.length >= 0.5,
    };
  }, [inventory]);
  const ideas = recipeIdeas.slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Refrigerator} label="Items in stock" value={inventory.length} onClick={() => setTab("storage")} />
        <Stat icon={Clock} label="Use soon" value={useSoon.length}
          tone={urgent ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300" : undefined} onClick={() => setTab("storage")} />
        <Stat icon={TrendingDown} label="Running low" value={lowStock.length}
          tone={lowStock.length ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200" : undefined} onClick={() => setTab("shopping")} />
        <Stat icon={ShoppingCart} label="Active lists" value={activeLists} onClick={() => setTab("shopping")} />
      </div>

      {money.reliable && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex items-center gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><Wallet className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="stat-num text-xl font-extrabold leading-none">{eur(money.total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Food in stock, from {money.covered} of {money.of} items with a price</p>
            </div>
          </Card>
          <Card className="flex items-center gap-3 p-4">
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", money.atRisk > 0 ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300" : "bg-accent text-accent-foreground")}><Clock className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="stat-num text-xl font-extrabold leading-none">{eur(money.atRisk)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{money.atRisk > 0 ? "Expires within 3 days. Cook it first." : "Nothing priced expires in the next 3 days"}</p>
            </div>
          </Card>
        </div>
      )}

      {ideas.length > 0 && (
        <Section title="Cook with what you have" sub="Best matches for your stock, favouring food that is about to expire."
          action={<Button variant="ghost" size="sm" onClick={() => setTab("kitchen")}>All recipes</Button>}>
          <div className="grid gap-3 md:grid-cols-3">
            {ideas.map((e) => (
              <button key={e.recipe.id} type="button" onClick={() => setTab("kitchen")}
                className="group flex flex-col gap-2 rounded-2xl border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><ChefHat className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.recipe.name}</span>
                </span>
                <span className={cn("text-xs", e.can_cook_now ? "font-medium text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                  {e.can_cook_now ? "Ready to cook" : `Missing ${e.missing.map((m) => m.name.toLowerCase()).join(", ")}`}
                </span>
                {e.uses_expiring.length > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">Uses up {e.uses_expiring.map((u) => u.name.toLowerCase()).join(", ")}</span>}
              </button>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Use these soon" sub="Soonest first. Tap one to open the space it is in.">
          {useSoon.length === 0 ? (
            <EmptyState icon={Check} title="Nothing about to expire" sub="Everything has at least a week left." />
          ) : (
            <ul className="-mx-2 divide-y divide-border">
              {useSoon.map((g) => {
                const exp = expiryLabel(g.expiration);
                const space = locationOf(locations, g);
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => onOpenSpace(space?.id)} disabled={!space}
                      className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent">
                      <CatIcon category={g.category} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{g.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{quantityText(g.quantity, g.unit)}{space ? ` · ${space.name}` : ""}</span>
                      </span>
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", TONES[exp.tone])}>{daysUntil(g.expiration) < 0 ? "Expired" : exp.text}</span>
                      {space && <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Running low" sub="Add what you need to the selected shopping list."
          action={<Button variant="ghost" size="sm" onClick={() => setTab("shopping")}>Open lists</Button>}>
          {lowStock.length === 0 ? (
            <EmptyState icon={Check} title="Stocked up" sub="Nothing is below its low-stock threshold." />
          ) : (
            <ul className="-mx-2 divide-y divide-border">
              {lowStock.map((g) => {
                const listed = onList.has(g.name.toLowerCase());
                return (
                  <li key={g.id} className="flex items-center gap-3 px-2 py-2">
                    <CatIcon category={g.category} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{g.name}</span>
                      <span className={cn("block text-xs", g.status === "out" ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                        {g.status === "out" ? "Out of stock" : `${quantityText(g.quantity, g.unit)} left`}
                      </span>
                    </span>
                    <Button size="sm" variant={listed ? "ghost" : "outline"} disabled={listed} onClick={() => onAddToList(g)} aria-label={listed ? `${g.name} is on the list` : `Add ${g.name} to the list`}>
                      {listed ? <><Check className="mr-1 h-4 w-4" />On list</> : <><Plus className="mr-1 h-4 w-4" />Add</>}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Your spaces" sub="Jump straight into the kitchen.">
        <div className="flex flex-wrap gap-2">
          {locations.map((l) => {
            const count = inventory.filter((g) => locationOf(locations, g)?.id === l.id).length;
            return (
              <Button key={l.id} variant="outline" className="rounded-full" onClick={() => onOpenSpace(l.id)}>
                {l.name}<span className="ml-2 text-xs text-muted-foreground">{count}</span>
              </Button>
            );
          })}
          <Button className="rounded-full bg-emerald-700 text-white hover:bg-emerald-700" onClick={() => setTab("storage")}>
            <Refrigerator className="mr-1.5 h-4 w-4" />Open the kitchen
          </Button>
        </div>
      </Section>
    </div>
  );
}
