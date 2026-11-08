/* global window, localStorage */
const assert = require("node:assert/strict");
const { PASSWORD } = require("./w5aRehearsal.fixture.cjs");

module.exports = async (t, f) => {
  const browser = await f.browser();
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === f.origin || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const client = f.users.find((user) => user.label === "client");
  const loginUI = async (target) => {
    await target.waitForFunction(() => Boolean(window.w5aModules));
    await target.locator('input[name="email"]').fill(client.email);
    await target.locator('input[name="password"]').fill(PASSWORD);
    const response = target.waitForResponse((res) => new URL(res.url()).pathname === "/api/login" && res.request().method() === "POST");
    await target.locator('button[type="submit"]').click();
    const login = await response;
    assert.equal(login.status(), 200);
    const payload = await login.json();
    await target.waitForURL("**/dashboard");
    return payload;
  };
  f.switchBackend("old");
  f.switchFrontend("old");
  await page.goto(`${f.origin}/auth`);
  const oldLogin = await loginUI(page);
  assert.ok(oldLogin.token && !oldLogin.token.startsWith("cookie."), "the actual old controller must issue the old response");
  await page.evaluate(async () => {
    // Retain the actual old API module even when a new tab loads the candidate.
    window.w5aOldApi = window.w5aModules.api;
    window.w5aLoaded = "old-document";
  });
  const oldStorage = await page.evaluate(() => ({ token: localStorage.getItem("token"), expiryDate: localStorage.getItem("expiryDate"), userId: localStorage.getItem("userId") }));
  assert.equal(oldStorage.token, oldLogin.token);
  const oldCookie = (await context.cookies()).find((row) => row.name === "hd.session_token");
  assert.ok(oldCookie?.httpOnly);
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
  const browserReadWrite = async (label) => page.evaluate(async (stage) => {
    const { api } = window.w5aOldApi;
    const me = await api("/api/me");
    const pulse = await api("/api/pulse");
    const form = new FormData();
    form.append("description", `Synthetic old-tab ${stage}`);
    form.append("state", "Новая");
    form.append("source", "Портал");
    form.append("attachments", new Blob(["synthetic browser upload"], { type: "text/plain" }), "browser.txt");
    const { ticket } = await api("/api/tickets/add", { method: "POST", body: form });
    const comment = new FormData();
    comment.append("ticketId", ticket._id);
    comment.append("content", `Synthetic old-tab comment ${stage}`);
    await api("/api/comments/add", { method: "POST", body: comment });
    const read = await api(`/api/tickets/${ticket.num}?view=form`);
    const after = await api(`/api/pulse?ticket=${ticket._id}`);
    return { userId: me.user._id, sessionId: me.sessionId, changed: after.topics.tickets > pulse.topics.tickets,
      description: read.ticket.description, attachments: read.ticket.attachments.length };
  }, label);
  const initial = await browserReadWrite("before");
  assert.equal(initial.userId, client.id);
  assert.equal(await page.evaluate(async () => (await window.w5aModules.cache.load("/api/me")).sessionId), initial.sessionId);
  f.switchBackend("candidate");
  const after = await browserReadWrite("after");
  assert.equal(after.sessionId, initial.sessionId);
  assert.equal(after.userId, client.id);
  assert.equal(after.changed, true);
  assert.equal(after.attachments, 1);
  assert.equal(navigations, 0, "backend replacement alone must not reload an old tab");

  f.switchFrontend("candidate");
  const second = await context.newPage();
  await second.goto(`${f.origin}/dashboard`);
  await second.waitForFunction(() => Boolean(window.w5aModules?.session.browserSessionKey()));
  const shared = await second.evaluate(() => ({ token: localStorage.getItem("token"), expiryDate: localStorage.getItem("expiryDate"), userId: localStorage.getItem("userId") }));
  assert.ok(shared.token, "new tab must retain a compatibility identity for old tabs");
  assert.equal(shared.expiryDate, oldStorage.expiryDate, "new tab must not clear or invent the old expiry boundary");
  assert.equal(shared.userId, oldStorage.userId);
  assert.equal(await second.evaluate(() => window.w5aModules.session.browserSessionKey()), JSON.stringify([client.id, initial.sessionId]));
  assert.equal((await browserReadWrite("after-new-tab")).sessionId, initial.sessionId);
  // A real login in a second tab changes the cache namespace, even for the
  // same user. The old loaded cache must not return its previous /me session.
  await second.goto(`${f.origin}/auth`);
  await second.waitForURL("**/dashboard"); // valid cookies intentionally bypass the login form
  await second.waitForFunction(() => Boolean(window.w5aModules?.auth));
  // Invoke the actual compiled signIn/storeSession flow for this synthetic
  // session replacement; an authenticated tab has no login inputs to fill.
  const replacementResponse = second.waitForResponse((res) => new URL(res.url()).pathname === "/api/login" && res.request().method() === "POST");
  const outcome = await second.evaluate(({ email, password }) =>
    window.w5aModules.auth.signIn("/api/login", { email, password }, "Synthetic session replacement failed"),
  { email: client.email, password: PASSWORD });
  assert.deepEqual(outcome, { status: "session" });
  const response = await replacementResponse;
  assert.equal(response.status(), 200);
  const relogin = await response.json();
  assert.notEqual(relogin.token, `cookie.${initial.sessionId}`);
  const cachedAfterLogin = await page.evaluate(async () => window.w5aModules.cache.load("/api/me"));
  assert.equal(cachedAfterLogin.user._id, client.id);
  assert.equal(`cookie.${cachedAfterLogin.sessionId}`, relogin.token);
  // Fresh candidate profile has cookies but no localStorage credentials.
  const fresh = await browser.newContext();
  try {
    await fresh.route("**/*", (route) => new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort());
    const newPage = await fresh.newPage();
    await newPage.goto(`${f.origin}/auth`);
    const payload = await loginUI(newPage);
    assert.match(payload.token, /^cookie\./);
    const stored = await newPage.evaluate(() => localStorage.getItem("token"));
    assert.ok(stored === null || stored === payload.token, "only the inert compatibility marker may be persisted");
    const raw = await f.current.api.getSession({ headers: new Headers({ cookie: (await fresh.cookies()).map((row) => `${row.name}=${row.value}`).join("; ") }) });
    assert.ok(raw?.session);
    assert.ok(!JSON.stringify(await newPage.evaluate(() => ({ ...localStorage }))).includes(raw.session.token));
  } finally { await fresh.close(); }

  // An OLD loaded login form receives candidate compatibility metadata.
  f.switchFrontend("old");
  const legacy = await browser.newContext();
  try {
    await legacy.route("**/*", (route) => new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort());
    const loginPage = await legacy.newPage();
    await loginPage.goto(`${f.origin}/auth`);
    const markerLogin = await loginUI(loginPage);
    assert.match(markerLogin.token, /^cookie\./);
    assert.equal(await loginPage.evaluate(() => localStorage.getItem("token")), markerLogin.token);
    f.switchBackend("old");
    const rollback = await loginPage.evaluate(async () => (await window.w5aModules.api.api("/api/me")).user._id);
    assert.equal(rollback, client.id, "old backend must accept cookie with public marker bearer");
    f.switchBackend("candidate");
  } finally { await legacy.close(); }

  // Keep the old bundle's existing localStorage deadline authoritative. Advance
  // only a fresh synthetic page's JS clock; never change the host/server clock.
  const expiryContext = await browser.newContext();
  try {
    await expiryContext.route("**/*", (route) => new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort());
    const expiryPage = await expiryContext.newPage();
    await expiryPage.clock.install();
    await expiryPage.goto(`${f.origin}/auth`);
    await loginUI(expiryPage);
    await expiryPage.evaluate(() => localStorage.setItem("expiryDate", new Date(Date.now() + 2000).toISOString()));
    await expiryPage.reload();
    await expiryPage.waitForFunction(() => Boolean(window.w5aModules));
    const expiredLogout = expiryPage.waitForResponse((res) => new URL(res.url()).pathname === "/api/logout" && res.request().method() === "POST");
    await expiryPage.clock.fastForward(3000);
    assert.equal((await expiredLogout).status(), 200, "the old deadline still performs intentional server logout");
    assert.equal(await expiryPage.evaluate(async () => (await fetch("/api/me")).status), 401);
  } finally { await expiryContext.close(); }

  // Exercise the existing 503 error screen's probe/reload, retaining cookies.
  f.switchFrontend("old");
  const recovery = await context.newPage();
  await recovery.route("**/api/me", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Synthetic restart"}' }));
  await recovery.goto(`${f.origin}/dashboard`);
  await recovery.getByText("Обновляемся", { exact: true }).waitFor();
  await recovery.unroute("**/api/me");
  await Promise.all([
    recovery.waitForEvent("load"),
    recovery.getByRole("button", { name: "Проверить сейчас", exact: true }).click(),
  ]);
  assert.equal(await recovery.evaluate(async () => (await fetch("/api/me")).status), 200);
  await recovery.close();

  await require("./w5aCookieRenewal.rehearsal.cjs")(t, f, browser);
  const currentCookie = (await context.cookies()).find((row) => row.name === "hd.session_token");
  assert.ok(currentCookie);
  // Deliberate browser-cookie expiry boundary: preserve stale legacy storage.
  await context.clearCookies({ name: "hd.session_token" });
  await context.addCookies([{ ...currentCookie, expires: Math.floor(Date.now() / 1000) - 1 }]);
  assert.equal(await page.evaluate(async () => (await fetch("/api/me")).status), 401);
  // Restore the synthetic cookie only to exercise explicit, server-side logout.
  await context.addCookies([currentCookie]);
  const logout = await page.evaluate(async () => (await fetch("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status);
  assert.equal(logout, 200);
  assert.equal(await page.evaluate(async () => (await fetch("/api/me")).status), 401);
  t.diagnostic("Actual baseline/candidate frontend Vite builds, fresh Chromium contexts, old/new tabs, login, multipart/comments/Pulse, renewal/expiry, recovery, rollback and logout. Deployment nginx and real Telegram delivery are outside this fixture.");
};
