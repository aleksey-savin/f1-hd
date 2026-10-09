// RouterOS license of a managed device — pure, shared by the poll mapper and
// the row DTO.
//
// /system/license/print answers in two shapes:
//   RouterBOARD / x86:  software-id, nlevel (0–6), features
//   CHR:                system-id, level (free | p1 | p10 | p-unlimited),
//                       next-renewal-at, deadline-at, limited-upgrades
// A RouterBOARD license (levels 3–6) is perpetual. A CHR renews itself against
// the MikroTik account; once deadline-at passes without a renewal the router
// keeps forwarding but reports limited-upgrades and refuses RouterOS upgrades.
// The device does not say whether a CHR license is a trial — only the dates.

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// Days before deadline-at at which a still-valid CHR license is flagged: the
// device normally renews well ahead, so a close deadline means renewals fail.
const EXPIRING_SOON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// "may/10/2016 21:59:59" (RouterOS ≤ 7.9) or "2016-05-10 21:59:59" (7.10+) →
// Date, read as UTC (the device clock zone is unknown; a day of slack is fine
// for an expiry flag). Anything else → null.
const parseDeviceDate = (value) => {
  const text = String(value || "").trim().toLowerCase();
  let match = text.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (match) {
    const month = MONTHS[match[1]];
    if (month === undefined) return null;
    return new Date(
      Date.UTC(+match[3], month, +match[2], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0)),
    );
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{2}):(\d{2}):(\d{2}))?$/);
  if (match) {
    return new Date(
      Date.UTC(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0)),
    );
  }
  return null;
};

const isTrue = (value) => ["true", "yes"].includes(String(value || "").toLowerCase());

// Reply rows of /system/license/print → the stored `license` subdocument, or
// null when the device gave no level (nothing to store — the previous value
// stays). Absent dates are stored as null so a renewed license clears them.
const parseLicense = (rows) => {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const level = String(row.nlevel ?? row.level ?? "").trim().toLowerCase();
  if (!level) return null;
  return {
    level,
    softwareId: row["software-id"] || null,
    systemId: row["system-id"] || null,
    deadlineAt: parseDeviceDate(row["deadline-at"]),
    nextRenewalAt: parseDeviceDate(row["next-renewal-at"]),
    limitedUpgrades: isTrue(row["limited-upgrades"]),
  };
};

const CHR_LABEL = {
  free: "CHR Free",
  p1: "CHR P1",
  p10: "CHR P10",
  "p-unlimited": "CHR Unlimited",
};

// Row field `license`: null — not read yet. `state`: "ok" | "expired" (CHR
// deadline passed or limited-upgrades) | "inactive" (CHR Free, x86 demo levels
// 0–1). `soon` — still valid but the deadline is within EXPIRING_SOON_DAYS.
const licenseView = (record, now = new Date()) => {
  const license = record?.license;
  if (!license?.level) return null;
  const base = {
    softwareId: license.softwareId || null,
    systemId: license.systemId || null,
    until: null,
    soon: false,
  };
  if (/^\d+$/.test(license.level)) {
    const level = Number(license.level);
    return {
      ...base,
      kind: "routeros",
      level: license.level,
      label: `L${level}`,
      state: level <= 1 ? "inactive" : "ok",
    };
  }
  const deadline = license.deadlineAt ? new Date(license.deadlineAt) : null;
  const expired =
    Boolean(license.limitedUpgrades) || (deadline !== null && deadline <= now);
  let state = "ok";
  if (license.level === "free") state = "inactive";
  else if (expired) state = "expired";
  return {
    ...base,
    kind: "chr",
    level: license.level,
    label: CHR_LABEL[license.level] || `CHR ${license.level}`,
    state,
    until: deadline,
    soon:
      state === "ok" &&
      deadline !== null &&
      deadline - now <= EXPIRING_SOON_DAYS * DAY_MS,
  };
};

module.exports = {
  EXPIRING_SOON_DAYS,
  parseDeviceDate,
  parseLicense,
  licenseView,
};
