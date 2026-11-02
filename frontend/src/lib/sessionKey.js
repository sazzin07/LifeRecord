// Binding a session to this browser, so a copy of the refresh cookie is not enough to use.
//
// The browser makes an ECDSA P-256 key pair with WebCrypto and marks the private half NON-EXTRACTABLE: nothing, not even this
// page's own script, can read it out; it can only be asked to sign. The public half is announced when a session starts
// (`X-Session-Key`) and every refresh carries a short signed proof (`X-Session-Proof`). The server refuses a refresh without one, so
// a cookie copied from a log, a backup or a proxy is useless on its own. (What it cannot stop: someone who also has this browser's
// whole profile, or script running in the page, which can ask the browser to sign.)
//
// Nothing here is required: with no WebCrypto, or with storage that forbids IndexedDB (some private windows), this announces no key
// and signs nothing, and the session is an ordinary one, exactly as before.

const DB_NAME = "lr-keys";
const STORE = "keys";
const KEY_ID = "session";
const encode = (text) => new TextEncoder().encode(text);

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomHex = (bytes) => Array.from(window.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

// -- where the key pair lives: IndexedDB, which can store a CryptoKey without ever exposing its bytes --------------------------
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const indexedDbStore = {
  async get() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY_ID);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },
  /** Keep `pair` unless another tab got there first; either way, return the pair that is now stored. */
  async addIfAbsent(pair) {
    const db = await openDatabase();
    const added = await new Promise((resolve) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).add(pair, KEY_ID);
      request.onsuccess = () => resolve(true);
      request.onerror = (event) => { event.preventDefault(); resolve(false); };  // already there: another tab won
    });
    return added ? pair : indexedDbStore.get();
  },
};

/** Where the key pair is kept. A plain object so tests can replace it; `null` means "nowhere" (the session is then unbound). */
export const keyStorage = { current: typeof window !== "undefined" && window.indexedDB ? indexedDbStore : null };

let pending = null;  // two parts of the page asking at the same moment share one answer
async function keyPair() {
  if (typeof window === "undefined" || !window.crypto?.subtle || !keyStorage.current) return null;
  pending = pending || (async () => {
    const existing = await keyStorage.current.get();
    if (existing) return existing;
    const made = await window.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    return keyStorage.current.addIfAbsent(made);
  })().finally(() => { pending = null; });
  return pending;
}

let clockOffset = 0;  // server time minus this computer's time, so a wrong clock does not make every proof look stale
/** Learn the server's time from the `Date` header of any answer (or forget it, with null). */
export function noteServerTime(dateHeader) {
  const server = dateHeader ? Date.parse(dateHeader) : NaN;
  clockOffset = Number.isFinite(server) ? server - Date.now() : 0;
}

/** The public key to announce when a session starts, or null when this browser cannot keep one. */
export async function sessionKeyHeader() {
  try {
    const pair = await keyPair();
    if (!pair) return null;
    const jwk = await window.crypto.subtle.exportKey("jwk", pair.publicKey);
    return base64url(encode(JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y })));
  } catch {
    return null;
  }
}

/** A fresh signed proof for one refresh, or null when this browser cannot make one. Every call makes a new one. */
export async function signProof() {
  try {
    const pair = await keyPair();
    if (!pair) return null;
    const payload = base64url(encode(JSON.stringify({ iat: Date.now() + clockOffset, jti: randomHex(16) })));
    const signature = await window.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, encode(payload));
    return `${payload}.${base64url(signature)}`;
  } catch {
    return null;
  }
}
