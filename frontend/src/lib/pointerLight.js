/** The light that follows the mouse across a card (spec §K.5c). One handler goes on the page's stage: the `.mny-card` under the mouse gets the
 *  pointer position as --mx / --my and its glow (theme/orchid.css) follows it. Mouse only: touch and pen never move it. */
export function followPointer(e) {
  if (e.pointerType !== "mouse") return;
  const card = e.target.closest?.(".mny-card");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}
