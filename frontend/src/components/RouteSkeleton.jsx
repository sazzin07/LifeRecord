import { useLocation } from "react-router-dom";
import { Busy, Sk, SkCard, SkChart, SkRows } from "@/components/skeletons";
import { Card } from "@/components/common";

/** What stands in for a page while its code is still being downloaded (first visit only: after that the page is already here and draws at
 *  once from the last-seen data). It is the page's own outline: the header every page has, then the shape of its first screen. */
function Header() {
  return (
    <div className="mb-4 flex items-end justify-between gap-4" aria-hidden="true">
      <div className="space-y-2"><Sk className="h-7 w-44 sm:h-8" /><Sk className="h-3.5 w-64 max-w-full" /></div>
      <Sk className="h-9 w-28 !rounded-full" />
    </div>
  );
}

const Stats = ({ n = 4 }) => (
  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden="true">
    {Array.from({ length: n }, (_, i) => <Card key={i} className="p-4 sm:p-5"><Sk className="h-3 w-20" /><Sk className="mt-2 h-8 w-28" /><Sk className="mt-1.5 h-3 w-24" /></Card>)}
  </div>
);

function Home() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Sk className="h-[19rem] w-full !rounded-3xl md:h-[17rem]" />
      <Stats />
      <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <SkCard key={i}><SkRows n={3} lead={null} /></SkCard>)}</div>
    </div>
  );
}
function Money() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex gap-2">{[0, 1, 2, 3].map((i) => <Sk key={i} className="h-9 w-24 shrink-0 !rounded-full" />)}</div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <SkCard className="lg:col-span-4"><Sk className="h-12 w-48" /></SkCard>
        <SkCard className="lg:col-span-4"><SkRows n={3} /></SkCard>
        <SkCard className="md:col-span-2 lg:col-span-4"><Stats n={2} /></SkCard>
      </div>
      <SkCard><SkChart height={220} /></SkCard>
    </div>
  );
}
function List() {
  return <div className="space-y-4" aria-hidden="true"><Stats n={3} /><Card className="p-5"><SkRows n={5} /></Card></div>;
}
function Form() {
  return <div className="space-y-4" aria-hidden="true"><SkCard><Sk className="h-10 w-full" /></SkCard><SkCard><SkRows n={3} lead="square" figure={false} /></SkCard></div>;
}

const BY_SECTION = { "": Home, money: Money, people: List, groceries: List, nutrition: List, fitness: List, calendar: List, tasks: Form, body: Form, settings: Form, profile: Form };

export function RouteSkeleton() {
  const section = useLocation().pathname.split("/")[1] || "";
  const Body = BY_SECTION[section] || List;
  return (
    <Busy label="Loading the page">
      <Header />
      <Body />
    </Busy>
  );
}

const sessionHint = () => { try { return Object.keys(localStorage).some((k) => k.startsWith("lm_cache:")); } catch { return false; } };
const sideMenuOpen = () => { try { return localStorage.getItem("lr-sidebar") === "pinned"; } catch { return false; } };

/** The signed-in app's outline while the first sign-in check is under way, for someone who has used the app on this device: the side strip, the
 *  top bar and the page's own outline, so a returning visitor sees the structure at once instead of a blank screen. A first-time visitor (nothing
 *  remembered here) gets the plain wait, since they are about to see the sign-in page. */
export function BootSkeleton({ note }) {
  const pad = sideMenuOpen() ? "lg:pl-60" : "lg:pl-16";
  return (
    <div className="min-h-screen bg-background">
      <aside aria-hidden="true" className={`fixed inset-y-0 left-0 hidden border-r border-border bg-card/60 lg:block ${sideMenuOpen() ? "w-60" : "w-16"}`}>
        <div className="flex h-16 items-center gap-2 border-b border-border px-4"><Sk className="h-8 w-8 shrink-0 !rounded-xl" />{sideMenuOpen() && <Sk className="h-4 w-24" />}</div>
        <div className="space-y-2 p-3">{Array.from({ length: 10 }, (_, i) => <Sk key={i} className="h-10 w-full !rounded-xl" />)}</div>
      </aside>
      <header aria-hidden="true" className={`sticky top-0 h-16 border-b border-border ${pad}`}>
        <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6"><Sk className="h-10 w-full max-w-md !rounded-full" /><div className="ml-auto flex gap-2"><Sk className="h-10 w-10 !rounded-full" /><Sk className="h-10 w-20 !rounded-full" /><Sk className="h-10 w-10 !rounded-full" /></div></div>
      </header>
      <main className={pad}>
        {note}
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><RouteSkeleton /></div>
      </main>
    </div>
  );
}

export const hasSessionHint = sessionHint;
