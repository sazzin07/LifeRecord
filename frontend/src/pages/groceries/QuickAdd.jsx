import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { CATS, catOf } from "./shared";
import { Glyph } from "./glyphs";
import { Sticker, cap1 } from "./todayParts";

/* The add bar at the top of Groceries. On Shopping it puts things on the current list: it understands "3 lemons" or "500 g rice" and suggests
   as you type. Anywhere else it puts a food in the open storage space ("buy oat milk" or "add to list oat milk" goes on the list instead). */
export function parseAdd(text) {
  const m = String(text).trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|x)?\s+(.+)$/i);
  if (!m) return { n: 1, u: "unit", name: String(text).trim() };
  const u = (m[2] || "unit").toLowerCase();
  return { n: Number(m[1].replace(",", ".")), u: u === "x" ? "unit" : u === "l" ? "L" : u, name: m[3].trim() };
}

export function QuickAdd({ tab, products, inventory, recipeIdeas, listItems, listId, locations, spaceId, setTab }) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const shopping = tab === "shopping";
  const narrow = useMediaQuery("(max-width: 639px)");   // a phone has room for only a short hint
  const space = locations.find((l) => l.id === spaceId) || locations[0] || null;

  const choices = useMemo(() => {
    if (!shopping) return [];
    const q = text.trim().toLowerCase().replace(/^\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|x)?\s*/, "");
    if (!q) return [];
    const onList = new Set(listItems.map((i) => i.name.toLowerCase()));
    // what you own first, then what your recipes use, then the whole catalog
    const pool = [
      ...(inventory || []).map((g) => ({ name: g.name, category: catOf(g), unit: g.unit })),
      ...(recipeIdeas || []).flatMap((e) => (e.recipe?.ingredients || []).map((i) => ({ name: cap1(i.name), category: Glyph.category(i.name), unit: i.unit }))),
      ...(products || []).map((p) => ({ name: p.name, category: catOf(p), unit: p.default_unit })),
    ];
    const seen = new Set();
    return pool.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k) || onList.has(k) || !k.includes(q)) return false; seen.add(k); return true; }).slice(0, 5);
  }, [shopping, text, products, inventory, recipeIdeas, listItems]);

  const clear = () => { setText(""); setActive(-1); };
  const toList = async (name, n, unit, category) => {
    if (!listId) { toast.error("Create a shopping list first"); return false; }
    try {
      await api.post("/shopping", { name, quantity: n, unit: unit || "unit", category: CATS.includes(category) ? category : Glyph.category(name), list_id: listId });
      toast.success(`Added ${name} to your shopping list`);
      refreshAll();
      return true;
    } catch (err) { toast.error(err.response?.data?.detail || "Could not add to the list"); return false; }
  };
  const toKitchen = async (name) => {
    if (!space) { toast.error("Set up your kitchen first, then add food to a space"); setTab("today"); return false; }
    const known = (products || []).find((p) => p.name.toLowerCase() === name.toLowerCase()) || (inventory || []).find((g) => g.name.toLowerCase() === name.toLowerCase());
    const category = known ? catOf(known) : Glyph.category(name);
    try {
      await api.post("/groceries", { name, quantity: 1, unit: known?.default_unit || known?.unit || "unit", category, storage_location: space.name });
      toast.success(`Added ${name} to ${space.name}`);
      refreshAll();
      return true;
    } catch (err) { toast.error(err.response?.data?.detail || "Could not add the food"); return false; }
  };

  const submit = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      let ok;
      if (shopping && active >= 0 && choices[active]) { const p = parseAdd(t), c = choices[active]; ok = await toList(c.name, p.n, p.u !== "unit" ? p.u : c.unit, c.category); }
      else if (shopping) { const p = parseAdd(t); ok = p.name ? await toList(cap1(p.name), p.n, p.u, "") : false; }
      else {
        const m = t.match(/^(buy|add to list)\s+(.+)/i);
        ok = m ? await toList(cap1(m[2].trim()), 1, "unit", "") : await toKitchen(cap1(t));
      }
      if (ok) { clear(); input.current?.focus(); }
    } finally { setBusy(false); }
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown" && choices.length) { e.preventDefault(); setActive((i) => (i + 1) % choices.length); }
    else if (e.key === "ArrowUp" && choices.length) { e.preventDefault(); setActive((i) => (i - 1 + choices.length) % choices.length); }
    else if (e.key === "Escape" && text) { e.preventDefault(); clear(); }
  };

  return (
    <form className="gt gt-cmd" role="search" aria-label="Add food" onSubmit={submit}>
      <Input ref={input} value={text} onChange={(e) => { setText(e.target.value); setActive(-1); }} onKeyDown={onKey} autoComplete="off"
        aria-label={shopping ? "Add to the shopping list" : "Add a food or a list item"}
        placeholder={narrow
          ? (shopping ? '"3 lemons" or "500 g rice"' : space ? `Add a food, or "buy oat milk"` : '"buy oat milk"')
          : shopping ? 'Add to the list: "3 lemons", "500 g rice", or just a name' : space ? `Type a food to put it in ${space.name}, or "buy oat milk"` : 'Type "buy oat milk" to put it on the list'}
        role="combobox" aria-expanded={choices.length > 0} aria-controls="gt-cmd-ac" aria-autocomplete="list" aria-activedescendant={active >= 0 ? `gt-cmd-o${active}` : undefined} />
      <button type="submit" className="gt-btn cta" disabled={busy || !text.trim()}><Plus aria-hidden="true" />Add</button>
      {choices.length > 0 && (
        <div className="gt-ac" id="gt-cmd-ac" role="listbox" aria-label="Suggestions">
          {choices.map((c, i) => {
            const p = parseAdd(text), how = p.u !== "unit" ? `${+p.n.toFixed(2)} ${p.u} ` : p.n !== 1 ? `${+p.n.toFixed(2)} × ` : "";
            return (
            <button key={c.name} id={`gt-cmd-o${i}`} type="button" role="option" aria-selected={active === i} tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()} onClick={async () => { const p = parseAdd(text); if (await toList(c.name, p.n, p.u !== "unit" ? p.u : c.unit, c.category)) clear(); }}>
              <Sticker name={c.name} category={c.category} size={30} /><span>{how}{c.name}</span>
            </button>
            );
          })}
        </div>
      )}
    </form>
  );
}
