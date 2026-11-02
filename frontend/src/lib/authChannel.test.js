import { announceSignedOut, onSignedOutElsewhere } from "./authChannel";

// A minimal BroadcastChannel: every channel with the same name receives what another channel object posts.
function install() {
  const all = [];
  global.BroadcastChannel = class {
    constructor(name) { this.name = name; this.onmessage = null; this.closed = false; all.push(this); }
    postMessage(data) {
      all.filter((c) => c !== this && c.name === this.name && !c.closed && c.onmessage).forEach((c) => c.onmessage({ data }));
    }
    close() { this.closed = true; }
  };
  return all;
}

afterEach(() => { delete global.BroadcastChannel; });

test("a listener hears when the person signs out, and stops hearing once it unsubscribes", () => {
  install();
  const heard = jest.fn();
  const stop = onSignedOutElsewhere(heard);
  // another tab: a different module instance would have a different tab id, so post as one
  global.BroadcastChannel.prototype.postMessage.call(new global.BroadcastChannel("lr-auth"), { type: "signed-out", from: "some-other-tab" });
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
  global.BroadcastChannel.prototype.postMessage.call(new global.BroadcastChannel("lr-auth"), { type: "signed-out", from: "some-other-tab" });
  expect(heard).toHaveBeenCalledTimes(1);
});

test("a tab ignores its own announcement, and anything that is not a sign-out", () => {
  install();
  const heard = jest.fn();
  onSignedOutElsewhere(heard);
  announceSignedOut();  // this tab's own id
  global.BroadcastChannel.prototype.postMessage.call(new global.BroadcastChannel("lr-auth"), { type: "something-else", from: "x" });
  global.BroadcastChannel.prototype.postMessage.call(new global.BroadcastChannel("lr-auth"), null);
  expect(heard).not.toHaveBeenCalled();
});

test("a browser without BroadcastChannel signs out quietly, with nothing thrown", () => {
  delete global.BroadcastChannel;
  expect(() => announceSignedOut()).not.toThrow();
  const stop = onSignedOutElsewhere(() => {});
  expect(() => stop()).not.toThrow();
});
