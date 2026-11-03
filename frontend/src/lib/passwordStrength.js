/** How a new password is judged on the screen, before it is sent. The server has the last word (length, a letter and a number, no common
 *  password, not the address, not found in known leaks); this only tells the person early and in words what would make it stronger. */
const COMMON = ["password", "passw0rd", "qwerty", "letmein", "welcome", "admin", "iloveyou", "abc123", "123456", "111111", "liferecord"];

export const checksFor = (pw, { email = "", current = "" } = {}) => {
  const local = (email.split("@")[0] || "").toLowerCase();
  return [
    { id: "length", label: "At least 8 characters", ok: pw.length >= 8 },
    { id: "letter", label: "A letter", ok: /[A-Za-z]/.test(pw) },
    { id: "number", label: "A number", ok: /\d/.test(pw) },
    { id: "different", label: "Different from your current password", ok: pw.length > 0 && pw !== current },
    { id: "own", label: "Not your name or address", ok: !(local.length >= 4 && pw.toLowerCase().includes(local)) },
  ];
};

/** score 0 (nothing / not allowed) to 4 (strong), a word for it, and the one thing that would help most. */
export function strength(pw, ctx = {}) {
  if (!pw) return { score: 0, label: "", tip: "" };
  const checks = checksFor(pw, ctx);
  const lower = pw.toLowerCase();
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const distinct = new Set(pw).size;
  let score = pw.length >= 16 ? 3 : pw.length >= 12 ? 2 : pw.length >= 8 ? 1 : 0;
  if (kinds >= 3 && pw.length >= 8) score += 1;
  if (distinct <= 3 || COMMON.some((c) => lower.includes(c)) || /^(?:0123|1234|2345|3456|abcd|qwer)/.test(lower)) score = Math.min(score, 1);
  if (!checks.every((c) => c.ok)) score = Math.min(score, pw.length < 8 ? 0 : 1);
  score = Math.max(0, Math.min(4, score));
  const label = ["Too weak", "Weak", "Fair", "Good", "Strong"][score];
  const tip = pw.length < 12 ? "Longer is stronger: try 12 characters or more." : kinds < 3 ? "Mix capitals, numbers or symbols." : "";
  return { score, label, tip };
}

/** A random password that is easy to read out and retype: four groups of four, no look-alike characters, always a letter and a number. */
export function suggestPassword(random = (n) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return a; }) {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const pick = (set, r) => set[r % set.length];
  for (;;) {
    const r = random(16);
    const chars = Array.from(r, (v) => pick(all, v));
    const text = chars.join("");
    if (/\d/.test(text) && /[A-Za-z]/.test(text)) return text.match(/.{4}/g).join("-");
  }
}
