const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("generated documentation links cannot request loopback endpoints", async () => {
  const source = fs.readFileSync(`${__dirname}/ticketAiTerms.js`, "utf8");
  const start = source.indexOf("const verifyDocLinks =");
  const body = source.slice(
    start,
    source.indexOf("\nconst normalizeBlocks", start),
  );
  let requests = 0;
  const verify = new Function(
    "fetch",
    "MAX_LINKS",
    "LINK_TIMEOUT_MS",
    "probePublicUrl",
    body + ";return verifyDocLinks;",
  )(
    async () => {
      requests++;
      return { status: 200 };
    },
    5,
    6000,
    (...args) => require("./publicUrlProbe").probePublicUrl(...args),
  );
  assert.deepEqual(
    await verify([{ url: "http://127.0.0.1:8080/private" }]),
    [],
  );
  assert.equal(requests, 0);
});
