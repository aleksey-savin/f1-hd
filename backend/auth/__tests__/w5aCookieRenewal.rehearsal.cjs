const assert = require("node:assert/strict");
const { PASSWORD } = require("./w5aRehearsal.fixture.cjs");

const assertExtended = (cookie, deadline) => assert.ok(
  cookie && cookie.expires > deadline + 1,
  "Browser renewal did not extend the recorded cookie deadline",
);

module.exports = async (t, f, browser) => {
  const client = f.users.find((user) => user.label === "client");
  const exercise = async (withhold) => {
    const context = await browser.newContext();
    let control;
    try {
      await context.route("**/*", (route) => new URL(route.request().url()).origin === f.origin ? route.continue() : route.abort());
      const page = await context.newPage();
      // No application, Pulse loop or JS clock in either control page. Only
      // the explicit fetch below can renew this context's fresh session.
      await page.goto(`${f.origin}/__tests__/w5a-cookie-renewal`);
      assert.equal(await page.evaluate(async ({ email, password }) => (await fetch("/api/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
      })).status, { email: client.email, password: PASSWORD }), 200);
      const issued = (await context.cookies()).find((row) => row.name === "hd.session_token");
      assert.ok(issued?.httpOnly);
      const session = await f.current.api.getSession({ headers: new Headers({ cookie: `${issued.name}=${issued.value}` }) });
      assert.ok(session?.session);
      await f.db.collection("authSessions").updateOne({ token: session.session.token }, { $set: {
        expiresAt: new Date(Date.now() + 3600000), updatedAt: new Date(Date.now() - 2 * 86400000),
      } });

      const deadline = Math.floor(Date.now() / 1000) + 6;
      await context.addCookies([{ ...issued, expires: deadline }]);
      const before = (await context.cookies()).find((row) => row.name === issued.name);
      assert.equal(before?.expires, deadline, "the actual browser cookie must start with the short deadline");
      assert.ok(deadline * 1000 - Date.now() > 2000, "renewal must start before the short cookie expires");
      control = withhold ? f.withholdRenewalCookies() : null;
      const status = await page.evaluate(async (headers) => (await fetch("/api/me", { headers, cache: "no-store" })).status, control?.headers || {});
      assert.equal(status, 200, "the short cookie must authenticate the renewal request");
      assert.ok(Date.now() < deadline * 1000, "observe renewal before the original deadline");
      const observed = (await context.cookies()).find((row) => row.name === issued.name);
      if (withhold) {
        assert.ok(control.stats.suppressed > 0, "the server must actually attempt a renewal Set-Cookie");
        assert.equal(observed?.expires, deadline, "the server-side control must withhold the cookie before Chromium sees it");
        assert.throws(() => assertExtended(observed, deadline), {
          code: "ERR_ASSERTION", message: "Browser renewal did not extend the recorded cookie deadline",
        });
      } else {
        assertExtended(observed, deadline);
      }

      // Wait at most 6.25 seconds of real elapsed time. Cookie expiry uses the
      // browser's real clock; neither host/server time nor page time is changed.
      const waitMs = deadline * 1000 - Date.now() + 250;
      assert.ok(waitMs > 0 && waitMs <= 6250);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      assert.ok(Date.now() > deadline * 1000);
      const pastDeadline = (await context.cookies()).find((row) => row.name === issued.name);
      if (withhold) assert.equal(pastDeadline, undefined, "withheld renewal must leave an expired browser cookie");
      else assertExtended(pastDeadline, deadline);
      const afterStatus = await page.evaluate(async () => (await fetch("/api/me", { cache: "no-store" })).status);
      assert.equal(afterStatus, withhold ? 401 : 200, "access past the old deadline must depend on delivery of renewal cookies");
      const persisted = await f.db.collection("authSessions").findOne({ token: session.session.token });
      assert.ok(persisted && persisted.expiresAt.getTime() > deadline * 1000 + 60000,
        "both server sessions must remain valid; negative refusal must come from browser cookie expiry");
      t.diagnostic(`Browser renewal ${withhold ? "negative control" : "positive"}: original deadline ${deadline}, observed expiry ${observed?.expires}, past-deadline HTTP ${afterStatus}${withhold ? `; suppressed ${control.stats.suppressed} Set-Cookie, identical extension assertion rejected` : ""}`);
    } finally {
      control?.release();
      await context.close();
    }
  };
  await Promise.all([exercise(false), exercise(true)]);
};
