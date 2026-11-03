import { streamChat } from "./aiStream";

// aiStream imports the shared axios client through the "@/" alias, which Jest does not resolve (and axios' ES-module
// build does not load under it). A virtual mock stands in for it: this test only needs the fetch path.
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, API: "http://server.test/api", getAccessToken: () => "memory-token" }), { virtual: true });

const respond = (status, body, headers = {}) => Promise.resolve({
  ok: status >= 200 && status < 300, status, body: status === 429 ? {} : null,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: () => Promise.resolve(body),
});

describe("streamChat when the server refuses with a limit", () => {
  afterEach(() => { delete global.fetch; });

  test("shows the server's own wording instead of a generic failure", async () => {
    const detail = "That is too many assistant messages in a minute (the limit is 20). Try again in 12 seconds.";
    global.fetch = jest.fn(() => respond(429, { detail }, { "retry-after": "12" }));
    const events = [];
    await streamChat({ message: "hi", sessionId: "s", onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: "error", message: detail }]);
    expect(global.fetch).toHaveBeenCalledTimes(1); // a limit is not retried through the plain endpoint
  });

  test("falls back to a plain sentence if the refusal carries no readable detail", async () => {
    global.fetch = jest.fn(() => ({ ...respond(429, null), json: () => Promise.reject(new Error("not json")) }));
    const events = [];
    await streamChat({ message: "hi", sessionId: "s", onEvent: (e) => events.push(e) });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].message).toMatch(/could not answer/i);
  });
});

describe("one id per send", () => {
  afterEach(() => { delete global.fetch; });

  test("the streaming request carries a client_request_id, and the plain-endpoint retry carries the SAME one", async () => {
    const { api } = require("@/lib/api");
    global.fetch = jest.fn(() => Promise.reject(new TypeError("network down")));
    api.post.mockResolvedValueOnce({ data: { reply: "ok", session_id: "s", actions: [], changed: false } });
    await streamChat({ message: "Ferreira owes me 10", sessionId: "s", onEvent: () => {} });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("two sends get two different ids", async () => {
    const ids = [];
    global.fetch = jest.fn((url, init) => { ids.push(JSON.parse(init.body).client_request_id); return respond(500, null); });
    const { api } = require("@/lib/api");
    api.post.mockImplementation((path, body) => { ids.push(body.client_request_id); return Promise.resolve({ data: { reply: "x", session_id: "s", actions: [] } }); });
    await streamChat({ message: "a", sessionId: "s", onEvent: () => {} });
    await streamChat({ message: "b", sessionId: "s", onEvent: () => {} });
    const [streamA, plainA, streamB, plainB] = ids;
    expect(streamA).toBeTruthy();
    expect(plainA).toBe(streamA);       // the retry through the plain endpoint is the same send
    expect(plainB).toBe(streamB);
    expect(streamA).not.toBe(streamB);  // a new message is a new request
  });
});
