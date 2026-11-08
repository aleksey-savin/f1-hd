const test = require("node:test");
const assert = require("node:assert/strict");
const { createProxmoxTools } = require("./proxmoxTools");

test("every Proxmox tool rechecks access and never reads after revocation", async () => {
  let allowed = true;
  let checks = 0;
  let reads = 0;
  const source = { authorize: async (keyId) => { checks++; assert.equal(keyId, "key"); return allowed; } };
  for (const method of ["list", "detail", "metrics", "events"]) {
    source[method] = async () => { reads++; return { status: "unknown", tenant: "B", owner: "A" }; };
  }
  const tools = createProxmoxTools({ source });
  for (const tool of Object.values(tools)) {
    allowed = true;
    const result = await tool({}, { keyId: "key" });
    assert.equal(JSON.parse(result.content[0].text).status, "unknown");
    allowed = false;
    assert.equal((await tool({}, { keyId: "key" })).isError, true);
  }
  assert.equal(checks, 8);
  assert.equal(reads, 4);
  assert.deepEqual(Object.keys(tools), ["list", "detail", "metrics", "events"]);
});
