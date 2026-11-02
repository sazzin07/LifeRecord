// Tabs of one browser tell each other when the person signs out, so a second tab does not keep showing an account whose
// session the server has already ended. (Without this it found out at its next request; with no BroadcastChannel in the
// browser that is still what happens.) The message carries no data at all, only "signed out".
const NAME = "lr-auth";
const tabId = Math.random().toString(36).slice(2);
let poster = null;

export function announceSignedOut() {
  try {
    poster = poster || new BroadcastChannel(NAME);
    poster.postMessage({ type: "signed-out", from: tabId });
  } catch { /* no BroadcastChannel: the other tab finds out at its next request */ }
}

/** Calls `callback` when ANOTHER tab signs out. Returns the function that stops listening. */
export function onSignedOutElsewhere(callback) {
  try {
    const channel = new BroadcastChannel(NAME);
    channel.onmessage = (event) => {
      if (event.data && event.data.type === "signed-out" && event.data.from !== tabId) callback();
    };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
