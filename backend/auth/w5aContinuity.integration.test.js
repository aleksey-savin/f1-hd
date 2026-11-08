const { test } = require("node:test");
const assert = require("node:assert/strict");

// Normal test/check.sh runs must not create Docker or browser processes.
test("W5a synthetic cross-version rehearsal (sol/high)", {
  skip: process.env.W5A_REHEARSAL !== "1" && "requires scoped Docker/HTTP permission; see deployment.md",
  timeout: 600000,
}, async (t) => {
  const { rehearsal, PASSWORD, SERVICE_TOKEN } = require("./__tests__/w5aRehearsal.fixture.cjs");
  const f = await rehearsal(t);
  const { ObjectId } = require("mongodb");
  const { runStaffSessionCutover } = require("../services/staffSessionCutover");
  const clients = f.users.filter((user) => user.label !== "staff");
  const staff = f.users.find((user) => user.label === "staff");
  const sessions = new Map();
  for (const user of f.users) sessions.set(user.id, await f.loginOld(user));
  const clientCookie = sessions.get(clients[0].id).cookie;
  const protectedCollections = ["authAccounts", "authTwoFactors", "telegramPairingCodes", "channels", "channelidentities"];
  for (const name of protectedCollections.slice(1)) {
    await f.db.collection(name).insertOne({ marker: "synthetic-preserve-me", userId: clients[0].id });
  }
  const protectedState = async () => JSON.stringify(await Promise.all(protectedCollections.map((name) => f.db.collection(name).find({}).sort({ _id: 1 }).toArray())));
  const before = await protectedState();
  const bindingBefore = (await f.db.collection("users").findOne({ email: clients[0].email })).telegramBot;
  assert.equal(Object.hasOwn(bindingBefore, "linkedAt"), false);

  const exercise = async (cookie, label) => {
    const identity = await f.send("/api/me", { cookie });
    assert.equal(identity.status, 200, label);
    const initialPulse = await f.send("/api/pulse", { cookie });
    assert.equal(initialPulse.status, 200);
    const initial = await initialPulse.json();
    const form = new FormData();
    form.append("description", `Synthetic ${label} continuity ticket`);
    form.append("state", "Новая");
    form.append("source", "Портал");
    form.append("responsibles", "[]");
    form.append("attachments", new Blob(["synthetic attachment"], { type: "text/plain" }), "synthetic.txt");
    const created = await f.send("/api/tickets/add", { cookie, body: form });
    assert.equal(created.status, 201, `${label}: ${await created.clone().text()}`);
    const { ticket } = await created.json();
    assert.equal(ticket.attachments.length, 1);
    const read = await f.send(`/api/tickets/${ticket.num}?view=form`, { cookie });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).ticket.description, `Synthetic ${label} continuity ticket`);
    const comment = new FormData();
    comment.append("ticketId", ticket._id);
    comment.append("content", `Synthetic ${label} comment`);
    const written = await f.send("/api/comments/add", { cookie, body: comment });
    assert.equal(written.status, 201, await written.clone().text());
    const pulse = await f.send(`/api/pulse?ticket=${ticket._id}`, { cookie });
    assert.equal(pulse.status, 200);
    const next = await pulse.json();
    assert.ok(next.topics.tickets > initial.topics.tickets, "real ticket writes must move Pulse");
    assert.ok(next.tickets[ticket._id] > 0);
  };

  await t.test("old library cookies support reads, multipart writes, comments and Pulse before replacement", async () => {
    for (const user of clients) await exercise(sessions.get(user.id).cookie, `old ${user.label}`);
  });
  f.switchBackend("candidate");
  await t.test("candidate accepts old cookies with stale/valid/absent bearer, refuses credential alone", async () => {
    for (const user of clients) {
      const { cookie, session } = sessions.get(user.id);
      for (const authorization of [undefined, `Bearer ${session.token}`, "Bearer stale-synthetic"])
        assert.equal((await f.send("/api/me", { cookie, authorization })).status, 200, user.label);
      for (const authorization of [`Bearer ${session.token}`, `Bearer cookie.${session.id}`])
        assert.equal((await f.send("/api/me", { authorization })).status, 401);
      await exercise(cookie, `candidate ${user.label}`);
    }
  });

  await t.test("real Mongo staff snapshot deletes native IDs, preserves clients and retry-era staff", async () => {
    const shared = new ObjectId();
    const impersonated = await f.ctx.internalAdapter.createSession(clients[0].id, false, { impersonatedBy: staff.id });
    const impCookie = f.cookieFrom(await f.old.api.setImpersonationCookie({ body: { token: impersonated.token }, asResponse: true }));
    // Same hex, different BSON types: both selected records must be deleted.
    await f.db.collection("authSessions").insertMany([
      { _id: shared, userId: new ObjectId(staff.id), token: "synthetic-object-session" },
      { _id: String(shared), userId: staff.id, token: "synthetic-string-session" },
    ]);
    await f.db.collection("impersonationCodes").insertMany([
      { _id: new ObjectId(), adminId: staff.id },
      { _id: "synthetic-code", impersonatedBy: new ObjectId(staff.id) },
    ]);
    const dry = await runStaffSessionCutover({ db: f.db });
    assert.equal(await f.db.collection("authCutovers").countDocuments(), 0, "dry run must not write");
    assert.deepEqual(dry.counts, { staffSessions: 3, impersonationSessions: 1, preservedClientSessions: 5, impersonationCodes: 2 });
    const applied = await runStaffSessionCutover({ db: f.db, apply: true });
    assert.deepEqual(applied.deleted, { sessions: 4, codes: 2 });
    assert.equal((await f.send("/api/me", { cookie: sessions.get(staff.id).cookie })).status, 401);
    assert.equal((await f.send("/api/me", { cookie: impCookie })).status, 401);
    for (const user of clients) assert.equal((await f.send("/api/me", { cookie: sessions.get(user.id).cookie })).status, 200);
    const newStaff = await f.send("/api/login", { body: { email: staff.email, password: PASSWORD } });
    assert.equal(newStaff.status, 200);
    const freshCookie = f.cookieFrom(newStaff);
    const retry = await runStaffSessionCutover({ db: f.db, apply: true });
    assert.deepEqual(retry.deleted, { sessions: 0, codes: 0 });
    assert.equal((await f.send("/api/me", { cookie: freshCookie })).status, 200);
    assert.equal(await protectedState(), before);
    assert.deepEqual((await f.db.collection("users").findOne({ email: clients[0].email })).telegramBot, bindingBefore);
  });

  await t.test("renewal forwards cookies, markers survive rollback, expiry/logout/ban remain authoritative", async () => {
    const login = await f.send("/api/login", { body: { email: clients[0].email, password: PASSWORD } });
    assert.equal(login.status, 200);
    const payload = await login.json();
    const cookie = f.cookieFrom(login);
    const session = await f.current.api.getSession({ headers: new Headers({ cookie }) });
    assert.match(payload.token, /^cookie\./);
    assert.ok(!JSON.stringify(payload).includes(session.session.token));
    assert.equal(login.headers.get("set-auth-token"), null);
    await f.db.collection("authSessions").updateOne({ token: session.session.token }, { $set: {
      expiresAt: new Date(Date.now() + 3600000), updatedAt: new Date(Date.now() - 2 * 86400000),
    } });
    const renewed = await f.send("/api/me", { cookie, authorization: `Bearer ${payload.token}` });
    assert.equal(renewed.status, 200);
    assert.ok(renewed.headers.getSetCookie().some((line) => /^hd.session_token=/.test(line) && /HttpOnly/i.test(line)));
    const renewedCookie = f.cookieFrom(renewed);
    f.switchBackend("old");
    assert.equal((await f.send("/api/me", { cookie: renewedCookie, authorization: `Bearer ${payload.token}` })).status, 200);
    assert.equal((await f.send("/api/me", { cookie: sessions.get(staff.id).cookie })).status, 401, "rollback must not resurrect deleted staff");
    f.switchBackend("candidate");
    const id = new ObjectId(clients[0].id);
    await f.db.collection("users").updateOne({ _id: id }, { $set: { banned: true } });
    assert.equal((await f.send("/api/me", { cookie: renewedCookie })).status, 401);
    await f.db.collection("users").updateOne({ _id: id }, { $set: { banned: false } });
    const out = await f.send("/api/logout", { cookie: renewedCookie, body: {} });
    assert.equal(out.status, 200);
    assert.ok(out.headers.getSetCookie().some((line) => /^hd.session_token=/.test(line) && /Max-Age=0/.test(line)));
    assert.equal((await f.send("/api/me", { cookie: renewedCookie })).status, 401);
    const expired = sessions.get(clients[1].id);
    await f.db.collection("authSessions").updateOne({ token: expired.session.token }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await f.send("/api/me", { cookie: expired.cookie })).status, 401);
  });

  await t.test("bot transport credentials and actor cannot become a browser identity", async () => {
    assert.equal((await f.send("/api/me", { headers: { "X-TG-Token": SERVICE_TOKEN, "X-TG-Actor": "123456789" } })).status, 401);
    for (const headers of [{}, { "X-TG-Token": SERVICE_TOKEN }, { "X-TG-Token": "wrong", "X-TG-Actor": "123456789" }, { "X-TG-Token": SERVICE_TOKEN, "X-TG-Actor": "999999999" }])
      assert.equal((await f.send("/api/bot/me", { cookie: clientCookie, headers })).status, 401);
    const response = await f.send("/api/bot/me", { cookie: clientCookie, headers: { "X-TG-Token": SERVICE_TOKEN, "X-TG-Actor": "123456789" } });
    assert.equal(response.status, 200);
  });

  await t.test("old bot photo+caption and same-chat outbox over a fake Telegram transport", async () => {
    await require("./__tests__/w5aBot.rehearsal.cjs")(t, f);
  });
  await t.test("old/new frontend browser and cookie boundary", {
    skip: process.env.W5A_BROWSER !== "1" && "requires explicit W5A_BROWSER=1 and scoped Chromium permission",
  }, async () => {
    await require("./__tests__/w5aBrowser.rehearsal.cjs")(t, f);
  });
});
