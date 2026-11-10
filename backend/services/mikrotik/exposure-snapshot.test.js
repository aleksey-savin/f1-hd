const test = require("node:test");
const assert = require("node:assert/strict");
const { collectRouterSnapshot } = require("./exposure-snapshot");
test("snapshot uses only fixed print commands and any failed table rejects the snapshot", async () => {
  const commands = [];
  const result = await collectRouterSnapshot(
    { _id: "r" },
    {
      read: async (words) => {
        commands.push(words);
        return [];
      },
    },
  );
  assert.ok(commands.length >= 10);
  assert.ok(
    commands.every(
      (words) => words.length === 1 && words[0].endsWith("/print"),
    ),
  );
  assert.deepEqual(result.nat, []);
  await assert.rejects(
    collectRouterSnapshot(
      { _id: "r" },
      {
        read: async (words) => {
          if (words[0].includes("/filter/")) throw new Error("denied");
          return [];
        },
      },
    ),
    /denied/,
  );
});
test("RouterOS 6 uses its routing rule menu and incomplete NAT rows fail closed", async () => {
  const commands = [];
  await collectRouterSnapshot(
    { _id: "r", currentFirmware: "6.49.18" },
    {
      read: async (words) => {
        commands.push(words[0]);
        return [];
      },
    },
  );
  assert.ok(commands.includes("/ip/route/rule/print"));
  await assert.rejects(
    collectRouterSnapshot(
      { _id: "r" },
      {
        read: async (words) =>
          words[0] === "/ip/firewall/nat/print"
            ? [{ action: "dst-nat", "to-addresses": "10.0.0.7" }]
            : [],
      },
    ),
    /Неполн/,
  );
});
