import axios from "axios";
import { noteServerTime, sessionKeyHeader, signProof } from "./sessionKey";
import { getAccessToken, refreshPolicy, refreshSession, sessionRefused, setAccessToken } from "./api";

// The shared axios client is not needed (and its ES-module build does not load under Jest). A stand-in records what the app
// registers on it and what it posts, so the refresh logic can be driven directly. Its state hangs off the mocked module,
// because Jest loads api.js before any variable declared in this file exists.
jest.mock("axios", () => {
  const handlers = {};
  const post = jest.fn();
  const replay = jest.fn();
  const instance = Object.assign((...args) => replay(...args), {
    interceptors: {
      request: { use: (fn) => { handlers.request = fn; } },
      response: { use: (ok, bad) => { handlers.ok = ok; handlers.bad = bad; } },
    },
  });
  return { __esModule: true, default: { create: () => instance, post: (...args) => post(...args), __handlers: handlers, __post: post, __replay: replay } };
});

// The key handling has its own tests (sessionKey.test.js); here it is replaced, to see what the client does with it.
jest.mock("./sessionKey", () => ({ sessionKeyHeader: jest.fn(), signProof: jest.fn(), noteServerTime: jest.fn() }));

const mockHandlers = axios.__handlers;
const mockPost = axios.__post;
const mockReplay = axios.__replay;

const network = () => Object.assign(new Error("Network Error"), { response: undefined });
const answer = (status) => Object.assign(new Error(`status ${status}`), { response: { status } });
const refreshKeys = () => mockPost.mock.calls.map((call) => call[2].headers["X-Refresh-Key"]);

beforeEach(() => {
  mockPost.mockReset();
  mockReplay.mockReset();
  refreshPolicy.delays = [0, 0];  // no waiting in tests
  sessionStorage.clear();
  setAccessToken(null);
  signProof.mockReset().mockResolvedValue(null);
  sessionKeyHeader.mockReset().mockResolvedValue(null);
  noteServerTime.mockReset();
});

describe("the access token", () => {
  test("is held in memory and can be cleared", () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken("abc");
    expect(getAccessToken()).toBe("abc");
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
    setAccessToken("");
    expect(getAccessToken()).toBeNull();
  });

  test("is never written to web storage", () => {
    const local = jest.spyOn(Storage.prototype, "setItem");
    setAccessToken("secret-access-token");
    expect(local).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).not.toContain("secret-access-token");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("secret-access-token");
    local.mockRestore();
  });
});

describe("refreshing when the network drops", () => {
  test("a failed attempt is repeated with the SAME key, so the server can tell it is the same request", async () => {
    mockPost.mockRejectedValueOnce(network()).mockRejectedValueOnce(network()).mockResolvedValueOnce({ data: { token: "fresh" } });
    await expect(refreshSession()).resolves.toBe("fresh");
    const keys = refreshKeys();
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[0-9a-z]{16,}$/);
    expect(getAccessToken()).toBe("fresh");
    expect(sessionStorage.length).toBe(0);  // nothing is left behind once it worked
  });

  test("a server error is treated like a dropped network: it is repeated, not taken for a sign-out", async () => {
    mockPost.mockRejectedValueOnce(answer(502)).mockResolvedValueOnce({ data: { token: "fresh" } });
    await expect(refreshSession()).resolves.toBe("fresh");
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test("an answer of 'no' is final: no repeats, and the key is forgotten", async () => {
    mockPost.mockRejectedValue(answer(401));
    await expect(refreshSession()).rejects.toMatchObject({ response: { status: 401 } });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });

  test("after giving up the key is kept, so the next try (even after a reload of this tab) repeats the same request", async () => {
    mockPost.mockRejectedValue(network());
    await expect(refreshSession()).rejects.toThrow("Network Error");
    expect(mockPost).toHaveBeenCalledTimes(1 + refreshPolicy.retries);
    const first = refreshKeys()[0];
    mockPost.mockReset().mockResolvedValue({ data: { token: "later" } });
    await expect(refreshSession()).resolves.toBe("later");
    expect(refreshKeys()).toEqual([first]);
  });

  test("the key is not a credential: it is not a token, and signing out is decided only by the server's answer", () => {
    expect(sessionRefused(answer(401))).toBe(true);
    expect(sessionRefused(answer(403))).toBe(true);
    for (const e of [answer(500), answer(502), answer(429), network()]) expect(sessionRefused(e)).toBe(false);
  });
});

describe("a request that finds its access token expired", () => {
  const expired = () => ({ config: { url: "/tasks", headers: {} }, response: { status: 401 } });
  let location;
  beforeEach(() => {
    location = window.location;
    delete window.location;
    window.location = { pathname: "/money", href: "http://localhost/money" };
    setAccessToken("stale");
  });
  afterEach(() => { window.location = location; });

  test("is retried with the new token when the refresh works", async () => {
    mockPost.mockResolvedValue({ data: { token: "fresh" } });
    mockReplay.mockResolvedValue({ data: "ok" });
    await expect(mockHandlers.bad(expired())).resolves.toEqual({ data: "ok" });
    expect(mockReplay.mock.calls[0][0].headers.Authorization).toBe("Bearer fresh");
  });

  test("is NOT signed out when the refresh could not reach the server: the request fails, the person stays where they are", async () => {
    mockPost.mockRejectedValue(network());
    await expect(mockHandlers.bad(expired())).rejects.toThrow("Network Error");
    expect(window.location.href).toBe("http://localhost/money");
    expect(getAccessToken()).toBe("stale");
  });

  test("is signed out when the server refuses the refresh", async () => {
    mockPost.mockRejectedValue(answer(401));
    await expect(mockHandlers.bad(expired())).rejects.toBeTruthy();
    expect(window.location.href).toBe("/login");
    expect(getAccessToken()).toBeNull();
  });

  test("requests waiting behind the refresh are released with the same outcome, never left hanging", async () => {
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    mockPost.mockImplementation(() => gate.then(() => { throw network(); }));  // every attempt fails once the gate opens
    const first = mockHandlers.bad(expired());
    const second = mockHandlers.bad(expired());  // arrives while the first refresh is still in flight
    open();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "rejected"]);
    expect(mockPost).toHaveBeenCalledTimes(1 + refreshPolicy.retries);  // one refresh with its repeats, not one per request
  });
});

describe("binding the session to this browser's key", () => {
  const sentHeaders = () => mockPost.mock.calls.map((call) => call[2].headers);

  test("every refresh carries a freshly signed proof, a new one for each attempt", async () => {
    signProof.mockResolvedValueOnce("proof-one.sig").mockResolvedValueOnce("proof-two.sig");
    mockPost.mockRejectedValueOnce(network()).mockResolvedValueOnce({ data: { token: "fresh" }, headers: {} });
    await refreshSession();
    expect(sentHeaders().map((h) => h["X-Session-Proof"])).toEqual(["proof-one.sig", "proof-two.sig"]);
  });

  test("a browser that cannot sign sends no proof at all and the refresh goes ahead as before", async () => {
    mockPost.mockResolvedValue({ data: { token: "fresh" }, headers: {} });
    await refreshSession();
    expect(sentHeaders()[0]["X-Session-Proof"]).toBeUndefined();
  });

  test("the public key is announced on the requests that begin a session, and only on those", async () => {
    sessionKeyHeader.mockResolvedValue("the-public-key");
    const begin = await mockHandlers.request({ url: "/auth/login", headers: {} });
    expect(begin.headers["X-Session-Key"]).toBe("the-public-key");
    const other = await mockHandlers.request({ url: "/tasks", headers: {} });
    expect(other.headers["X-Session-Key"]).toBeUndefined();
    sessionKeyHeader.mockResolvedValue(null);
    expect((await mockHandlers.request({ url: "/auth/verify", headers: {} })).headers["X-Session-Key"]).toBeUndefined();
  });

  test("the server's own clock is learned from its answers", () => {
    mockHandlers.ok({ headers: { date: "Mon, 02 Nov 2026 22:00:00 GMT" } });
    expect(noteServerTime).toHaveBeenCalledWith("Mon, 02 Nov 2026 22:00:00 GMT");
  });

  test("a refusal that comes from a badly wrong clock is corrected from the server's date and tried once more, not taken for a sign-out", async () => {
    const fiveMinutesAhead = new Date(Date.now() + 5 * 60_000).toUTCString();
    mockPost.mockRejectedValueOnce(Object.assign(new Error("401"), { response: { status: 401, headers: { date: fiveMinutesAhead } } }))
      .mockResolvedValueOnce({ data: { token: "fresh" }, headers: {} });
    await expect(refreshSession()).resolves.toBe("fresh");
    expect(noteServerTime).toHaveBeenCalledWith(fiveMinutesAhead);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test("a refusal with a correct clock is final: it is a real sign-out, so nothing is repeated", async () => {
    mockPost.mockRejectedValue(Object.assign(new Error("401"), { response: { status: 401, headers: { date: new Date().toUTCString() } } }));
    await expect(refreshSession()).rejects.toBeTruthy();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
