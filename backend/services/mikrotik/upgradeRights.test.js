// node --test services/mikrotik/upgradeRights.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REQUIRED_UPGRADE_POLICIES,
  parsePolicy,
  assessUpgradeRights,
  accessView,
} = require("./upgradeRights");

// The real group of GBG-VLD-SW05 (29.09): write is there, reboot and policy
// are denied — exactly the device whose upgrade was refused.
const SW05_GROUP =
  "ssh,read,write,test,api,!local,!telnet,!ftp,!reboot,!policy,!winbox,!password,!web,!sniff,!sensitive,!romon,!dude,!tikapp";

const hd = (group = "hd-mgmt") => [{ name: "hd", group }];

test("the required policies are the fix command's list, in its order", () => {
  assert.deepEqual(REQUIRED_UPGRADE_POLICIES, [
    "api",
    "read",
    "write",
    "reboot",
    "test",
    "ssh",
    "policy",
  ]);
});

test("parsePolicy keeps the granted names and drops the denied (!) ones", () => {
  const granted = parsePolicy("ssh, read,!write, api ,!policy");
  assert.deepEqual([...granted].sort(), ["api", "read", "ssh"]);
});

test("parsePolicy tolerates null, empty and blank items", () => {
  assert.equal(parsePolicy(null).size, 0);
  assert.equal(parsePolicy(undefined).size, 0);
  assert.equal(parsePolicy("").size, 0);
  assert.deepEqual([...parsePolicy("read,,  ,ssh")].sort(), ["read", "ssh"]);
});

test("assess: an unreadable /user means the account has no policy right", () => {
  // RouterOS answers /user/print only with `policy`; silence is the verdict.
  assert.deepEqual(assessUpgradeRights({ users: null, groups: null, user: "hd" }), {
    ok: false,
    missing: ["policy"],
  });
  assert.deepEqual(assessUpgradeRights({ users: undefined, groups: [], user: "hd" }), {
    ok: false,
    missing: ["policy"],
  });
});

test("assess: the managed user missing from the list → null", () => {
  const users = [{ name: "admin", group: "full" }];
  assert.equal(assessUpgradeRights({ users, groups: [], user: "hd" }), null);
});

test("assess: groups unreadable, or the user's group not listed → null", () => {
  assert.equal(assessUpgradeRights({ users: hd(), groups: null, user: "hd" }), null);
  assert.equal(
    assessUpgradeRights({
      users: hd(),
      groups: [{ name: "full", policy: "local,telnet,ssh,ftp,reboot,read,write,policy" }],
      user: "hd",
    }),
    null,
  );
});

test("assess: SW05's real group lacks reboot and policy", () => {
  assert.deepEqual(
    assessUpgradeRights({
      users: hd(),
      groups: [{ name: "hd-mgmt", policy: SW05_GROUP }],
      user: "hd",
    }),
    { ok: false, missing: ["reboot", "policy"] },
  );
});

test("assess: a full upgrade group is ok", () => {
  assert.deepEqual(
    assessUpgradeRights({
      users: hd(),
      groups: [
        { name: "hd-mgmt", policy: "api,read,write,reboot,test,ssh,policy,!local,!telnet,!ftp" },
      ],
      user: "hd",
    }),
    { ok: true, missing: [] },
  );
});

test("accessView: no record → null", () => {
  assert.equal(accessView(null), null);
  assert.equal(accessView(undefined), null);
});

test("accessView: switch off → read, whatever the stored verdict", () => {
  assert.equal(accessView({ firmwareUpgradeEnabled: false }), "read");
  assert.equal(accessView({}), "read");
  assert.equal(
    accessView({ firmwareUpgradeEnabled: false, upgradeRights: { ok: false, missing: ["policy"] } }),
    "read",
  );
});

test("accessView: switch on and rights refused → noWrite", () => {
  assert.equal(
    accessView({ firmwareUpgradeEnabled: true, upgradeRights: { ok: false, missing: ["policy"] } }),
    "noWrite",
  );
});

test("accessView: switch on, confirmed or never checked → write", () => {
  assert.equal(
    accessView({ firmwareUpgradeEnabled: true, upgradeRights: { ok: true, missing: [] } }),
    "write",
  );
  assert.equal(accessView({ firmwareUpgradeEnabled: true }), "write");
});

// --- rights for applying an agent's change request

const { REQUIRED_CHANGE_POLICIES, assessChangeRights } = require("./upgradeRights");

test("change rights: api, read, write, ssh — nothing else is required", () => {
  assert.deepEqual(REQUIRED_CHANGE_POLICIES, ["api", "read", "write", "ssh"]);
  // SW05's group cannot upgrade (no reboot / policy) but can apply changes
  assert.deepEqual(
    assessChangeRights({ users: hd(), groups: [{ name: "hd-mgmt", policy: SW05_GROUP }], user: "hd" }),
    { ok: true, missing: [] },
  );
});

test("change rights: a denied or absent policy is named, in the required order", () => {
  assert.deepEqual(
    assessChangeRights({ users: hd(), groups: [{ name: "hd-mgmt", policy: "ssh,read,!write,test" }], user: "hd" }),
    { ok: false, missing: ["api", "write"] },
  );
});

test("change rights: nothing to judge by gives null (the lists are unreadable without `policy`, which a change does not need)", () => {
  assert.equal(assessChangeRights({ users: undefined, groups: undefined, user: "hd" }), null);
  assert.equal(assessChangeRights({ users: [], groups: [], user: "hd" }), null);
  assert.equal(assessChangeRights({ users: hd(), groups: undefined, user: "hd" }), null);
  assert.equal(assessChangeRights({ users: hd("other"), groups: [{ name: "hd-mgmt", policy: "write" }], user: "hd" }), null);
  assert.equal(assessChangeRights(null), null);
});
