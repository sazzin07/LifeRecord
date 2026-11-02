import { getAccessToken, setAccessToken } from "./api";

// The shared axios client is not needed (and its ES-module build does not load under Jest): this only exercises the token holder.
jest.mock("axios", () => ({
  __esModule: true,
  default: { create: () => ({ interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }), post: jest.fn() },
}));

describe("the access token", () => {
  afterEach(() => setAccessToken(null));

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
