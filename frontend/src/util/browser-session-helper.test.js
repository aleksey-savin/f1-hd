import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserSessionKey,
  clearBrowserSession,
  confirmedUserId,
  confirmBrowserSession,
  onBrowserSessionChange,
  storeCompatibilitySession,
} from "./browser-session.js";

const storage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test("confirmed server identity replaces secret, preserves old keys/deadline and profile metadata", () => {
  clearBrowserSession();
  const oldTab = storage({
    token: "old-secret",
    expiryDate: "2001-01-01",
    userId: "old-user",
    timezone: "Asia/Vladivostok",
  });
  confirmBrowserSession({ user: { _id: "alice" }, sessionId: "s1" }, oldTab);
  assert.equal(oldTab.getItem("token"), "cookie.s1");
  assert.equal(oldTab.getItem("expiryDate"), "2001-01-01");
  assert.equal(oldTab.getItem("userId"), "alice");
  assert.equal(oldTab.getItem("timezone"), "Asia/Vladivostok");
  assert.equal(confirmedUserId(), "alice");
  assert.equal(browserSessionKey(), '["alice","s1"]');
});

test("identity/session transitions notify once; shared storage edits do not define identity", () => {
  clearBrowserSession();
  const local = storage();
  let changes = 0;
  const unsubscribe = onBrowserSessionChange(() => changes++);
  confirmBrowserSession({ user: { _id: "alice" }, sessionId: "s1" }, local);
  confirmBrowserSession({ user: { _id: "alice" }, sessionId: "s1" }, local);
  assert.equal(changes, 1);
  local.setItem("token", "cookie.another-tab");
  local.setItem("userId", "mallory");
  assert.equal(browserSessionKey(), '["alice","s1"]');
  confirmBrowserSession({ user: { _id: "alice" }, sessionId: "s2" }, local);
  confirmBrowserSession({ user: { _id: "bob" }, sessionId: "s2" }, local);
  clearBrowserSession();
  assert.equal(changes, 4);
  assert.equal(browserSessionKey(), null);
  assert.equal(confirmedUserId(), null);
  unsubscribe();
});

test("login compatibility data is not authority and cannot persist a usable credential", () => {
  clearBrowserSession();
  const local = storage();
  storeCompatibilitySession(
    { token: "usable-secret", expiryDate: "2030-01-01", userId: "alice" },
    local,
  );
  assert.equal(local.getItem("token"), null);
  storeCompatibilitySession(
    { token: "cookie.s1", expiryDate: "2030-01-01", userId: "alice" },
    local,
  );
  assert.equal(local.getItem("token"), "cookie.s1");
  assert.equal(local.getItem("expiryDate"), "2030-01-01T00:00:00.000Z");
  assert.equal(local.getItem("userId"), "alice");
  assert.equal(browserSessionKey(), null);
});

test("cookie-only bootstrap never invents an expiry date and invalid identity preserves state", () => {
  clearBrowserSession();
  const local = storage();
  confirmBrowserSession({ user: { _id: "alice" }, sessionId: "s1" }, local);
  assert.equal(local.getItem("expiryDate"), "");
  assert.throws(() =>
    confirmBrowserSession({ user: {}, sessionId: "s2" }, local),
  );
  assert.equal(browserSessionKey(), '["alice","s1"]');
  assert.equal(local.getItem("token"), "cookie.s1");
});
