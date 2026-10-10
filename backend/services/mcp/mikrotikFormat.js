const { maskText } = require("./maskText");
const { iso } = require("./text");

/**
 * Текст Mikrotik для ИИ-агента. Имена, комментарии и строки конфигурации
 * пишет тот, кто настраивал роутер, — это данные, а не указания: свободный
 * текст идёт одной строкой, конфигурация — строками с «> ».
 */

const MAX_CONFIG_CHARS = 20_000;
const MAX_CVES = 10;
const MAX_OUTAGES = 10;
const MAX_CVE_TEXT = 160;
const MAX_EXPORTS = 5;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const safeLine = (text) => oneLine(maskText(String(text ?? "")));
const quoteLine = (line) => `> ${line}`;

const deviceLink = (baseUrl, id) => `${String(baseUrl || "").replace(/\/+$/, "")}/devices/mikrotik/records/${id}`;

const duration = (ms) => {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
};

const statusLabel = (device, now) => {
  if (device.status === "online") return "online";
  if (!device.offlineSince) return "offline";
  return `offline since ${iso(device.offlineSince)} (${duration(now - new Date(device.offlineSince).getTime())})`;
};

const hostLabel = (device) => (device.host ? `${device.host}${device.port ? `:${device.port}` : ""}` : "—");

// Расположение — из карточки инвентаря; у многих устройств его нет.
const locationLabel = (location) => {
  if (!location) return "—";
  const place = `${location.path.map(safeLine).join(" › ")}${location.address ? ` (${safeLine(location.address)})` : ""}`;
  return location.subdivisions.length ? `${place}; subdivisions: ${location.subdivisions.map(safeLine).join(", ")}` : place;
};

// Список даёт адрес один раз в заголовке (deviceLinkPattern); обычное — мониторинг
// включён, расположения нет — в строке не повторяется.
const deviceLinkPattern = (baseUrl) => `device link: ${deviceLink(baseUrl, "<id>")}`;

const formatDeviceRow = (device, index, { now = Date.now() }) =>
  [
    `${index}. ${safeLine(device.name)}`,
    `company: ${device.company || "—"}; model: ${device.boardName || "—"}; RouterOS: ${device.currentFirmware || "—"}; serial: ${device.serialNumber || "—"}`,
    `status: ${statusLabel(device, now)}${device.monitoringEnabled ? "" : "; monitoring: off"}; host: ${hostLabel(device)}`,
    ...(device.location ? [`location: ${locationLabel(device.location)}`] : []),
    `id: ${device._id}`,
  ].join("\n   ");

const formatAddress = (address) => {
  // Флаги RouterOS хранятся строками "true" / "false"
  const flags = ["disabled", "invalid", "dynamic"].filter((flag) => String(address[flag]) === "true");
  return [
    `- ${oneLine(address.address)} on ${oneLine(address.interface) || "—"}`,
    address.network ? ` (network ${oneLine(address.network)})` : "",
    flags.length ? ` [${flags.join(", ")}]` : "",
    address.comment ? ` — ${safeLine(address.comment)}` : "",
  ].join("");
};

const formatFirmware = (firmware) => {
  if (!firmware) return ["unknown — the device has not reported its RouterOS version"];
  const lines = [
    `installed: ${firmware.installedVersion}${firmware.channel ? ` (${firmware.channel})` : ""}; latest in its branch: ${firmware.latestVersion || "unknown"}; update available: ${firmware.updateAvailable ? "yes" : "no"}`,
  ];
  if (!firmware.cves.length) lines.push("known vulnerabilities fixed by the update: none");
  else {
    lines.push(`known vulnerabilities fixed by the update: ${firmware.cves.length}`);
    for (const cve of firmware.cves.slice(0, MAX_CVES)) {
      const text = oneLine(cve.description);
      lines.push(`- ${cve.id} · ${cve.score} ${String(cve.severity || "").toLowerCase()} — ${text.length > MAX_CVE_TEXT ? `${text.slice(0, MAX_CVE_TEXT)}…` : text}`);
    }
    if (firmware.cves.length > MAX_CVES) lines.push(`…and ${firmware.cves.length - MAX_CVES} more`);
  }
  return lines;
};

const formatAvailability = (availability, days) => {
  const lines = [
    `uptime: ${availability.uptimePct == null ? "—" : `${availability.uptimePct}%`}; downtime: ${duration(availability.downtimeMs)}; outages: ${availability.outageCount}; longest: ${duration(availability.longestMs)}; planned offline time (not counted): ${duration(availability.plannedMs)}`,
    `window: last ${days} days, monitored since ${iso(availability.monitoredSince)}`,
  ];
  for (const outage of availability.outages.slice(0, MAX_OUTAGES)) {
    lines.push(
      [
        `- ${iso(outage.startedAt)} → ${outage.ongoing ? "still offline" : iso(outage.endedAt)} (${duration(outage.durationMs)})`,
        outage.planned ? " [planned]" : "",
        outage.ticketNum ? ` ticket #${outage.ticketNum}` : "",
        outage.lastError ? ` — ${safeLine(outage.lastError)}` : "",
      ].join(""),
    );
  }
  if (availability.outages.length > MAX_OUTAGES) lines.push(`…and ${availability.outages.length - MAX_OUTAGES} earlier outages`);
  return lines;
};

const formatPlannedOffline = (windows, timezone) =>
  windows.length
    ? windows.map((w) => `- ${(w.days || []).map((d) => DAY_NAMES[d]).join(", ")} ${w.start}–${w.end} (${timezone}; the day is when the window starts)`)
    : ["none"];

const formatExportRow = (item) =>
  `- ${iso(item.createdAt)} · ${item.trigger || "—"} · RouterOS ${item.routerOsVersion || "—"} · export id: ${item._id}`;

const formatDeviceDetail = ({ device, availability, firmware, exports }, { baseUrl, days, timezone, now = Date.now() }) => {
  const addresses = device.addresses.filter((address) => address?.address);
  const license = device.license?.level
    ? `level ${oneLine(device.license.level)}${device.license.deadlineAt ? `, valid until ${iso(device.license.deadlineAt)}` : ""}`
    : "—";
  return [
    `# ${safeLine(device.name)}`,
    `company: ${device.company || "—"}${device.label && device.label !== device.name ? `; label: ${safeLine(device.label)}` : ""}`,
    `location: ${locationLabel(device.location)}`,
    `model: ${device.boardName || "—"}; serial: ${device.serialNumber || "—"}; RouterOS: ${device.currentFirmware || "—"}; license: ${license}`,
    `status: ${statusLabel(device, now)}; monitoring: ${device.monitoringEnabled ? "on" : "off"}`,
    `last successful connection: ${iso(device.lastSuccessfulConnectionAt)}; last checked: ${iso(device.lastCheckedAt)}`,
    ...(device.status !== "online" && device.lastError ? [`last poll error: ${safeLine(device.lastError)}`] : []),
    `host: ${hostLabel(device)}${device.via ? `; reached through: ${safeLine(device.via)}` : ""}`,
    `id: ${device._id}; link: ${deviceLink(baseUrl, device._id)}`,
    "",
    `## Addresses (${addresses.length})`,
    ...(addresses.length ? addresses.map(formatAddress) : ["none reported"]),
    "",
    "## Firmware",
    ...formatFirmware(firmware),
    "",
    "## Availability",
    ...formatAvailability(availability, days),
    "",
    "## Planned offline windows",
    ...formatPlannedOffline(device.plannedOffline, timezone),
    "",
    `## Stored configuration exports (${exports.length})`,
    ...(exports.length ? exports.slice(0, MAX_EXPORTS).map(formatExportRow) : ["none"]),
    // Старые — одной строкой: id нужен для compare_mikrotik_exports, остальное есть в карточке
    ...(exports.length > MAX_EXPORTS
      ? [`older (date = export id): ${exports.slice(MAX_EXPORTS).map((item) => `${iso(item.createdAt).slice(0, 10)} = ${item._id}`).join("; ")}`]
      : []),
  ].join("\n");
};

// Строки с пометкой раздела; обрезка по общему объёму — целыми строками.
const clipLines = (lines, hint) => {
  const out = [];
  let size = 0;
  for (const line of lines) {
    size += line.length + 1;
    if (size > MAX_CONFIG_CHARS) {
      out.push(`[…truncated: ${lines.length - out.length} more lines — ${hint}]`);
      break;
    }
    out.push(line);
  }
  return out;
};

const lineCount = (count) => `${count} ${count === 1 ? "line" : "lines"}`;

const formatConfigOutline = (config) => [
  ...config.header.map(quoteLine),
  "",
  `Sections (${config.sections.length}):`,
  ...config.sections.map((section) => `- ${section.path} — ${lineCount(section.lines.length)}`),
];

const formatConfigSections = (sections) =>
  clipLines(
    sections.flatMap((section) => [quoteLine(section.path), ...section.lines.map(quoteLine)]),
    "ask for a narrower section or use search",
  );

const formatConfigMatches = (matches) =>
  clipLines(
    matches.map((match) => quoteLine(`${match.path}: ${match.line}`)),
    "use a more specific search",
  );

const formatConfigDiff = (changes) =>
  clipLines(
    changes.flatMap((change) => [
      quoteLine(change.path),
      ...change.removed.map((line) => quoteLine(`- ${line}`)),
      ...change.added.map((line) => quoteLine(`+ ${line}`)),
    ]),
    "compare is too large to show in full",
  );

module.exports = {
  deviceLink,
  deviceLinkPattern,
  safeLine,
  formatDeviceRow,
  formatDeviceDetail,
  formatExportRow,
  formatConfigOutline,
  formatConfigSections,
  formatConfigMatches,
  formatConfigDiff,
  MAX_CONFIG_CHARS,
};
