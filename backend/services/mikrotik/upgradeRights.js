// Rights of the managed RouterOS account for upgrades from HD — pure, shared by
// verify-on-save (controller), the upgrade worker and the row DTO.
//
// RouterOS answers /user/print and /user/group/print only to an account that
// holds the `policy` policy. An unreadable /user is therefore itself a
// verdict: the account lacks `policy`, which an upgrade needs anyway
// (check-for-updates is refused without it).

// What an upgrade from HD needs on the device, in the order of the fix command
// (upgradeErrors.js#RIGHTS_FIX is built from this list — keep the order).
const REQUIRED_UPGRADE_POLICIES = [
  "api",
  "read",
  "write",
  "reboot",
  "test",
  "ssh",
  "policy",
];

// "ssh,read,!write,…" → Set of granted names. A leading "!" denies; blanks and
// a missing string give an empty set.
const parsePolicy = (value) => {
  const granted = new Set();
  for (const raw of String(value || "").split(",")) {
    const item = raw.trim();
    if (!item || item.startsWith("!")) continue;
    granted.add(item);
  }
  return granted;
};

// { ok, missing } for the managed `user`, or null when the device gave nothing
// to judge by (user or group not in the lists — the stored verdict stays).
const assessUpgradeRights = ({ users, groups, user }) => {
  if (!Array.isArray(users)) return { ok: false, missing: ["policy"] };
  const account = users.find((item) => item.name === user);
  if (!account) return null;
  if (!Array.isArray(groups)) return null;
  const group = groups.find((item) => item.name === account.group);
  if (!group) return null;
  const granted = parsePolicy(group.policy);
  const missing = REQUIRED_UPGRADE_POLICIES.filter((name) => !granted.has(name));
  return { ok: missing.length === 0, missing };
};

// Row field `access`: null — no monitoring record; "read" — the per-device
// upgrade switch is off; "noWrite" — switch on but the device refused write
// rights; "write" — switch on otherwise (confirmed, or not checked yet).
const accessView = (record) => {
  if (!record) return null;
  if (!record.firmwareUpgradeEnabled) return "read";
  if (record.upgradeRights?.ok === false) return "noWrite";
  return "write";
};

module.exports = {
  REQUIRED_UPGRADE_POLICIES,
  parsePolicy,
  assessUpgradeRights,
  accessView,
};
