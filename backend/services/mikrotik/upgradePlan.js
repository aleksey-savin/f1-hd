const { parseFirmware, compareVersions } = require("./firmware");
const { CHANNEL_MODES } = require("./upgradeConstants");

// Firmware upgrade planning — pure: who is upgraded to what, who is skipped and
// why (shown as is in the confirmation dialog), and in which order.

// «Как на устройстве»: long-term stays long-term; stable, testing and an unknown
// channel aim at stable (testing is never a target; a testing build newer than
// stable is caught by the downgrade rule).
const targetChannel = (mode, parsed) =>
  mode === "current"
    ? parsed.channel === "long-term"
      ? "long-term"
      : "stable"
    : mode;

// The release cache is keyed like services/mikrotik/firmware.js#branchKeyFor.
const branchKey = (parsed, channel) =>
  `${parsed.major <= 6 ? "6" : "7"}.${channel}`;

const recordName = (record) =>
  record.name || record.label || record.credentials?.host || "устройство Mikrotik";

const verdictFor = (record, { channelMode, releases, busyIds }) => {
  if (!record.firmwareUpgradeEnabled) return { reason: "обновление из HD выключено" };
  if (!record.monitoringEnabled) return { reason: "мониторинг выключен" };
  if (record.status !== "online") return { reason: "не в сети" };
  if (busyIds.has(String(record._id))) return { reason: "уже в другом пакете" };

  const parsed = parseFirmware(record.currentFirmware);
  if (!parsed) return { reason: "версия прошивки ещё не считана" };

  const channel = targetChannel(channelMode, parsed);
  const latest = releases.get(branchKey(parsed, channel))?.version;
  if (!latest) return { reason: `нет данных о версиях ветки ${channel}` };

  const cmp = compareVersions(latest, parsed.version);
  if (cmp < 0) return { reason: `это откат с ${parsed.version} на ${latest}` };
  if (cmp === 0) return { reason: "уже актуальна" };
  return { plan: { channel, fromVersion: parsed.version, toVersion: latest } };
};

// Devices behind a transit router go before it: upgrading the router first
// would cut their path for the length of two reboots.
const orderItems = (items, recordsById) => {
  const inBatch = new Set(items.map((item) => String(item.mikrotik)));
  const routersWithDependents = new Set(
    items
      .map((item) => recordsById.get(String(item.mikrotik))?.jumpRecordId)
      .filter((id) => id && inBatch.has(String(id)))
      .map(String),
  );
  const rank = (item) => (routersWithDependents.has(String(item.mikrotik)) ? 1 : 0);
  return [...items].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"),
  );
};

const planUpgrade = ({ records, channelMode, releases, busyIds = new Set() }) => {
  if (!CHANNEL_MODES.includes(channelMode)) {
    throw new Error(`unknown channel mode ${channelMode}`);
  }
  const items = [];
  const skipped = [];
  for (const record of records) {
    const name = recordName(record);
    const verdict = verdictFor(record, { channelMode, releases, busyIds });
    if (verdict.reason) {
      skipped.push({ mikrotik: record._id, name, reason: verdict.reason });
    } else {
      items.push({ mikrotik: record._id, name, ...verdict.plan });
    }
  }
  const recordsById = new Map(records.map((record) => [String(record._id), record]));
  return {
    items: orderItems(items, recordsById),
    skipped: skipped.sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
};

module.exports = { planUpgrade, targetChannel, recordName };
