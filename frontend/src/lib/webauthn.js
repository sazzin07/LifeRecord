// Passkeys and security keys: the browser half of WebAuthn. The server speaks JSON with base64url strings; the browser's API wants
// ArrayBuffers. These functions convert both ways and turn the browser's DOMExceptions into words a person can act on.

export class PasskeyError extends Error {
  /** `cancelled`: the person dismissed the browser's prompt (or it timed out) - not a failure worth shouting about. */
  constructor(message, { cancelled = false } = {}) {
    super(message);
    this.name = "PasskeyError";
    this.cancelled = cancelled;
  }
}

export const passkeysSupported = () =>
  typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator?.credentials?.create && !!navigator?.credentials?.get;

/** Why passkeys cannot be used here, in words for the person, or null when they can. Browsers refuse them on an IP address and on a
 *  connection that is not secure (https, or localhost while developing), and old browsers lack them altogether. */
export function passkeyBlocker() {
  if (!passkeysSupported()) return "This browser cannot make passkeys. Open Life Record in a recent Chrome, Edge, Safari or Firefox.";
  if (window.isSecureContext === false) return "Passkeys need a secure connection (https). Open Life Record at its https address.";
  const host = window.location.hostname || "";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return "Passkeys do not work on an IP address. Open Life Record by its site name.";
  return null;
}

export function b64urlToBuffer(text) {
  const base64 = String(text).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(text).length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToB64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const descriptor = (item) => ({ ...item, id: b64urlToBuffer(item.id) });

/** The server's registration options (JSON) as navigator.credentials.create() wants them. */
export function creationOptions(json) {
  return {
    ...json,
    challenge: b64urlToBuffer(json.challenge),
    user: { ...json.user, id: b64urlToBuffer(json.user.id) },
    excludeCredentials: (json.excludeCredentials || []).map(descriptor),
  };
}

/** The server's sign-in options (JSON) as navigator.credentials.get() wants them. */
export function requestOptions(json) {
  return {
    ...json,
    challenge: b64urlToBuffer(json.challenge),
    allowCredentials: (json.allowCredentials || []).map(descriptor),
  };
}

const withoutNulls = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));

/** What a new passkey looks like on the wire. */
export function creationToJSON(credential) {
  const { response } = credential;
  return withoutNulls({
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: withoutNulls({
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      attestationObject: bufferToB64url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : undefined,
    }),
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
  });
}

/** What a sign-in with a passkey looks like on the wire. */
export function assertionToJSON(credential) {
  const { response } = credential;
  return withoutNulls({
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: withoutNulls({
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      authenticatorData: bufferToB64url(response.authenticatorData),
      signature: bufferToB64url(response.signature),
      userHandle: response.userHandle ? bufferToB64url(response.userHandle) : undefined,
    }),
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
  });
}

function explain(err, doing) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return new PasskeyError("The passkey prompt was closed or timed out. Try again when you are ready.", { cancelled: true });
  }
  if (name === "InvalidStateError") {
    return new PasskeyError(doing === "create" ? "This device already has a passkey for Life Record." : "That passkey is not recognised here.");
  }
  if (name === "SecurityError") return new PasskeyError("Passkeys cannot be used from this address. Open the app at its usual address.");
  if (name === "NotSupportedError") return new PasskeyError("This device does not support the kind of passkey Life Record asks for.");
  return new PasskeyError(doing === "create" ? "Could not create the passkey. Try again, or use another way." : "Could not use the passkey. Try again, or use another way.");
}

/** Ask the browser to make a passkey from the server's options. Resolves to the JSON to send back. */
export async function createPasskey(optionsJson) {
  if (!passkeysSupported()) throw new PasskeyError("This browser cannot make passkeys.");
  try {
    const credential = await navigator.credentials.create({ publicKey: creationOptions(optionsJson) });
    if (!credential) throw new PasskeyError("No passkey was created.", { cancelled: true });
    return creationToJSON(credential);
  } catch (err) {
    throw err instanceof PasskeyError ? err : explain(err, "create");
  }
}

/** Ask the browser to prove possession of a passkey. Resolves to the JSON to send back. */
export async function getPasskey(optionsJson) {
  if (!passkeysSupported()) throw new PasskeyError("This browser cannot use passkeys.");
  try {
    const credential = await navigator.credentials.get({ publicKey: requestOptions(optionsJson) });
    if (!credential) throw new PasskeyError("No passkey was used.", { cancelled: true });
    return assertionToJSON(credential);
  } catch (err) {
    throw err instanceof PasskeyError ? err : explain(err, "get");
  }
}
