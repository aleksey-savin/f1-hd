const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const { probePublicUrl, isPublicAddress } = require("./publicUrlProbe");

test("rejects local, private, mapped, multicast and special-purpose addresses", () => {
  for (const address of [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2002:7f00:1::",
    "2001:db8::1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(isPublicAddress(address), true, address);
});

test("rejects unsafe URL forms and any private DNS answer before requesting", async () => {
  let calls = 0;
  const options = {
    lookup: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    request: async () => {
      calls++;
      return { status: 200 };
    },
  };
  for (const url of [
    "http://127.1/private",
    "http://2130706433/private",
    "http://[::ffff:127.0.0.1]/",
    "https://user:pass@vendor.example/",
    "file:///etc/passwd",
    "https://vendor.example/",
  ])
    await assert.rejects(probePublicUrl(url, options));
  assert.equal(calls, 0);
});

test("checks redirect destinations and shares deadline across HEAD and GET fallback", async () => {
  const signal = AbortSignal.timeout(5000);
  const calls = [];
  await assert.rejects(
    probePublicUrl("https://vendor.example/", {
      signal,
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async (url, options) => {
        calls.push(options);
        return options.method === "HEAD"
          ? { status: 405 }
          : { status: 302, location: "http://169.254.169.254/private" };
      },
    }),
  );
  assert.deepEqual(
    calls.map((x) => x.method),
    ["HEAD", "GET"],
  );
  assert.ok(calls.every((x) => x.signal === signal));
});

test("pins the validated DNS answer into the socket lookup and discards GET bodies", async (t) => {
  let destroyed = false,
    lookups = 0;
  t.mock.method(https, "request", (url, options, onResponse) => {
    assert.equal(url.hostname, "vendor.example");
    assert.equal(options.agent, false);
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
    });
    const req = new EventEmitter();
    req.end = () =>
      onResponse({
        statusCode: 200,
        headers: {},
        destroy() {
          destroyed = true;
        },
      });
    return req;
  });
  assert.equal(
    await probePublicUrl("https://vendor.example/", {
      lookup: async () => {
        lookups++;
        return [{ address: "8.8.8.8", family: 4 }];
      },
    }),
    200,
  );
  assert.equal(lookups, 1);
  assert.equal(destroyed, true);
});

test("DNS stalls and redirect loops stop at the budget", async () => {
  const controller = new AbortController();
  const pending = probePublicUrl("https://vendor.example/", {
    signal: controller.signal,
    lookup: () => new Promise(() => {}),
  });
  controller.abort();
  await assert.rejects(pending);
  let calls = 0;
  await assert.rejects(
    probePublicUrl("https://vendor.example/", {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => {
        calls++;
        return { status: 302, location: "/again" };
      },
    }),
    /Too many/,
  );
  assert.equal(calls, 6);
});
