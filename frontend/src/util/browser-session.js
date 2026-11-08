// Подтверждённая сервером личность хранится только во вкладке. Общие старые ключи служат лишь сигналом сброса.
let identity = null;
let generation = 0;
let storageState;
let needsConfirmation = false;
const checks = new Set();
const listeners = new Set();

const storageSignature = (storage) =>
  JSON.stringify(
    ["token", "userId", "expiryDate"].map((key) => storage.getItem(key)),
  );

export function acknowledgeBrowserSessionStorage(storage = localStorage) {
  storageState = storageSignature(storage);
}

export function syncBrowserSessionStorage(storage = localStorage) {
  const next = storageSignature(storage);
  if (storageState !== undefined && storageState !== next) {
    generation++;
    needsConfirmation = true;
    identity = null;
    listeners.forEach((listener) => listener());
  }
  storageState = next;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (
      event.key === null ||
      ["token", "userId", "expiryDate"].includes(event.key)
    ) {
      syncBrowserSessionStorage();
    }
  });
}

export function browserSessionGeneration() {
  syncBrowserSessionStorage();
  return generation;
}

export function assertBrowserSessionCurrent(expected, signal) {
  syncBrowserSessionStorage();
  if (expected !== generation || signal?.aborted) {
    throw new DOMException("Obsolete browser session request", "AbortError");
  }
}

export function browserSessionNeedsConfirmation() {
  syncBrowserSessionStorage();
  return needsConfirmation;
}

export function checkingBrowserSession() {
  return checks.has(generation);
}

export function beginBrowserSessionCheck(signal) {
  syncBrowserSessionStorage();
  const expected = ++generation;
  checks.add(expected);
  return {
    generation: expected,
    assertCurrent: () => assertBrowserSessionCurrent(expected, signal),
    finish: () => checks.delete(expected),
  };
}

export function browserSessionKey() {
  return identity
    ? JSON.stringify([identity.user._id, identity.sessionId])
    : null;
}

export function confirmedUserId() {
  return identity?.user._id ?? null;
}

export function onBrowserSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setIdentity(next) {
  const previous = browserSessionKey();
  identity = next;
  if (previous !== browserSessionKey())
    listeners.forEach((listener) => listener());
}

export function clearBrowserSession() {
  generation++;
  needsConfirmation = false;
  setIdentity(null);
}

/** Фиксированный HTTP-контракт входа; не принимать заголовок с учётными данными или исходный токен. */
export function storeCompatibilitySession(data, storage = localStorage) {
  if (!/^cookie\.[A-Za-z0-9_-]+$/.test(data.token)) return;
  generation++;
  needsConfirmation = true;
  setIdentity(null);
  storage.setItem("token", data.token);
  storage.setItem("expiryDate", new Date(data.expiryDate).toISOString());
  storage.setItem("userId", String(data.userId));
  acknowledgeBrowserSessionStorage(storage);
}

export function confirmBrowserSession(
  data,
  storage = localStorage,
  check = null,
) {
  check?.assertCurrent();
  if (!data.user?._id || !data.sessionId)
    throw new Error("Missing server session identity");
  if (!check) generation++;
  setIdentity({
    user: { _id: String(data.user._id) },
    sessionId: String(data.sessionId),
  });
  storage.setItem("token", `cookie.${data.sessionId}`);
  storage.setItem("userId", String(data.user._id));
  // Сохраняем настоящий старый срок; не создаём и не продлеваем его.
  if (storage.getItem("expiryDate") === null) storage.setItem("expiryDate", "");
  needsConfirmation = false;
  acknowledgeBrowserSessionStorage(storage);
}
