import {
  assertionToJSON, b64urlToBuffer, bufferToB64url, createPasskey, creationOptions, creationToJSON, getPasskey, PasskeyError, passkeysSupported, requestOptions,
} from "./webauthn";

const bytes = (...numbers) => new Uint8Array(numbers).buffer;
const same = (buffer, ...numbers) => expect(Array.from(new Uint8Array(buffer))).toEqual(numbers);

describe("base64url", () => {
  test("round-trips every byte value, with no padding and no + or /", () => {
    const all = new Uint8Array(256).map((_, i) => i).buffer;
    const text = bufferToB64url(all);
    expect(text).not.toMatch(/[+/=]/);
    same(b64urlToBuffer(text), ...Array.from({ length: 256 }, (_, i) => i));
  });
  test("reads the unpadded forms the server sends", () => {
    same(b64urlToBuffer("AQI"), 1, 2);
    same(b64urlToBuffer("AQID"), 1, 2, 3);
    same(b64urlToBuffer("-_8"), 251, 255);
  });
});

describe("options from the server", () => {
  test("registration options get real buffers for the challenge, the user and each excluded key", () => {
    const options = creationOptions({
      challenge: "AQID", rp: { id: "x", name: "y" }, user: { id: "BAUG", name: "a@b.c", displayName: "A" },
      excludeCredentials: [{ id: "Bw", type: "public-key" }], pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    });
    same(options.challenge, 1, 2, 3);
    same(options.user.id, 4, 5, 6);
    same(options.excludeCredentials[0].id, 7);
    expect(options.excludeCredentials[0].type).toBe("public-key");
    expect(options.user.name).toBe("a@b.c");
  });
  test("sign-in options without allowed keys still work", () => {
    const options = requestOptions({ challenge: "AQID", rpId: "x" });
    same(options.challenge, 1, 2, 3);
    expect(options.allowCredentials).toEqual([]);
    expect(requestOptions({ challenge: "AQ", allowCredentials: [{ id: "Cg", type: "public-key", transports: ["usb"] }] }).allowCredentials[0].transports).toEqual(["usb"]);
  });
});

describe("answers to the server", () => {
  const credential = (response, extra = {}) => ({ id: "AQID", rawId: bytes(1, 2, 3), type: "public-key", authenticatorAttachment: null, getClientExtensionResults: () => ({}), response, ...extra });
  test("a new passkey is sent as base64url strings, with transports and without nulls", () => {
    const json = creationToJSON(credential({ clientDataJSON: bytes(9), attestationObject: bytes(8), getTransports: () => ["internal", "hybrid"] }));
    expect(json).toEqual({ id: "AQID", rawId: "AQID", type: "public-key", response: { clientDataJSON: "CQ", attestationObject: "CA", transports: ["internal", "hybrid"] }, clientExtensionResults: {} });
  });
  test("a sign-in answer leaves the user handle out when there is none", () => {
    const json = assertionToJSON(credential({ clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: null }, { authenticatorAttachment: "platform" }));
    expect(json.authenticatorAttachment).toBe("platform");
    expect(json.response).toEqual({ clientDataJSON: "AQ", authenticatorData: "Ag", signature: "Aw" });
  });
});

describe("talking to the browser", () => {
  const original = { PublicKeyCredential: window.PublicKeyCredential, credentials: Object.getOwnPropertyDescriptor(navigator, "credentials") };
  afterEach(() => {
    window.PublicKeyCredential = original.PublicKeyCredential;
    if (original.credentials) Object.defineProperty(navigator, "credentials", original.credentials);
    else delete navigator.credentials;
  });
  const install = (credentials) => {
    window.PublicKeyCredential = function PublicKeyCredential() {};
    Object.defineProperty(navigator, "credentials", { value: credentials, configurable: true });
  };
  const options = { challenge: "AQID", rp: { id: "x", name: "y" }, user: { id: "BAUG", name: "a", displayName: "a" } };

  test("without WebAuthn it says so and offers nothing", async () => {
    delete window.PublicKeyCredential;
    expect(passkeysSupported()).toBe(false);
    await expect(createPasskey(options)).rejects.toThrow(/cannot make passkeys/);
    await expect(getPasskey(options)).rejects.toThrow(/cannot use passkeys/);
  });
  test("a dismissed prompt is reported as cancelled, not as a failure", async () => {
    install({ create: () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })), get: () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })) });
    expect(passkeysSupported()).toBe(true);
    await expect(getPasskey(options)).rejects.toMatchObject({ cancelled: true });
    await expect(createPasskey(options)).rejects.toBeInstanceOf(PasskeyError);
  });
  test("other browser errors become sentences", async () => {
    install({ create: () => Promise.reject(Object.assign(new Error("x"), { name: "InvalidStateError" })), get: () => Promise.reject(Object.assign(new Error("x"), { name: "SecurityError" })) });
    await expect(createPasskey(options)).rejects.toThrow(/already has a passkey/);
    await expect(getPasskey(options)).rejects.toThrow(/usual address/);
  });
  test("a good answer is converted for the server", async () => {
    install({
      create: () => Promise.resolve({ id: "AQID", rawId: bytes(1, 2, 3), type: "public-key", getClientExtensionResults: () => ({}), response: { clientDataJSON: bytes(1), attestationObject: bytes(2) } }),
      get: () => Promise.resolve({ id: "AQID", rawId: bytes(1, 2, 3), type: "public-key", getClientExtensionResults: () => ({}), response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: null } }),
    });
    expect((await createPasskey(options)).response.attestationObject).toBe("Ag");
    expect((await getPasskey(options)).response.signature).toBe("Aw");
  });
});
