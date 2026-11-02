import { webcrypto } from "crypto";
import { TextEncoder } from "util";
import { keyStorage, noteServerTime, sessionKeyHeader, signProof } from "./sessionKey";

// The browser's job in binding a session to itself: make a key that cannot be read back out, announce the public half, and sign
// a short proof on every refresh. Node's WebCrypto stands in for the browser's; storage is a plain object instead of IndexedDB.

const b64uToBytes = (text) => Uint8Array.from(Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
const memoryStore = () => {
  const store = { held: null, get: async () => store.held, addIfAbsent: async (pair) => { store.held = store.held || pair; return store.held; } };
  return store;
};

let realCrypto;
beforeAll(() => {
  global.TextEncoder = TextEncoder;
  realCrypto = Object.getOwnPropertyDescriptor(window, "crypto");
});
beforeEach(() => {
  Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
  keyStorage.current = memoryStore();
  noteServerTime(null);
});
afterAll(() => { if (realCrypto) Object.defineProperty(window, "crypto", realCrypto); else delete window.crypto; });

test("the announced key is the public half only: a P-256 point, and nothing that could sign", async () => {
  const jwk = JSON.parse(Buffer.from(b64uToBytes(await sessionKeyHeader())).toString());
  expect(Object.keys(jwk).sort()).toEqual(["crv", "kty", "x", "y"]);
  expect(jwk.kty).toBe("EC");
  expect(jwk.crv).toBe("P-256");
  expect(jwk.d).toBeUndefined();
});

test("the private half can never be read back out of the browser", async () => {
  await sessionKeyHeader();
  const { privateKey } = keyStorage.current.held;
  expect(privateKey.extractable).toBe(false);
  await expect(webcrypto.subtle.exportKey("jwk", privateKey)).rejects.toThrow();
});

test("the same key is used every time, even when two parts of the page ask for it at the very same moment", async () => {
  const [a, b] = await Promise.all([sessionKeyHeader(), sessionKeyHeader()]);
  expect(a).toBe(b);
  expect(await sessionKeyHeader()).toBe(a);
});

test("a proof is a fresh, one-time, correctly signed statement that the server can check against the announced key", async () => {
  const jwk = JSON.parse(Buffer.from(b64uToBytes(await sessionKeyHeader())).toString());
  const first = await signProof();
  const second = await signProof();
  const [payloadText, signatureText] = first.split(".");
  const payload = JSON.parse(Buffer.from(b64uToBytes(payloadText)).toString());
  expect(Math.abs(payload.iat - Date.now())).toBeLessThan(5000);
  expect(payload.jti).toMatch(/^[0-9a-f]{16,}$/);
  expect(JSON.parse(Buffer.from(b64uToBytes(second.split(".")[0])).toString()).jti).not.toBe(payload.jti);
  const signature = b64uToBytes(signatureText);
  expect(signature).toHaveLength(64);  // raw r||s, the form WebCrypto produces and the server expects
  const publicKey = await webcrypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  expect(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, new TextEncoder().encode(payloadText))).toBe(true);
  expect(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, new TextEncoder().encode(payloadText + "x"))).toBe(false);
});

test("a clock that is wrong is corrected from the server's own date, so a proof is not refused as stale", async () => {
  noteServerTime(new Date(Date.now() + 5 * 60_000).toUTCString());  // this computer is five minutes behind the server
  const payload = JSON.parse(Buffer.from(b64uToBytes((await signProof()).split(".")[0])).toString());
  expect(Math.abs(payload.iat - (Date.now() + 5 * 60_000))).toBeLessThan(3000);
});

test("without WebCrypto the browser simply announces no key and signs nothing: the session is an ordinary one", async () => {
  delete window.crypto;
  Object.defineProperty(window, "crypto", { value: undefined, configurable: true });
  await expect(sessionKeyHeader()).resolves.toBeNull();
  await expect(signProof()).resolves.toBeNull();
});

test("storage that fails (a browser that forbids IndexedDB) is not an error either", async () => {
  keyStorage.current = { get: async () => { throw new Error("denied"); }, addIfAbsent: async () => { throw new Error("denied"); } };
  await expect(sessionKeyHeader()).resolves.toBeNull();
  await expect(signProof()).resolves.toBeNull();
  keyStorage.current = null;
  await expect(sessionKeyHeader()).resolves.toBeNull();
});
