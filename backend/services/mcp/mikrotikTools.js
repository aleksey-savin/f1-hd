const { resolveByName } = require("./ticketQuery");
const { iso } = require("./text");
const {
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
} = require("./mikrotikFormat");

/**
 * Инструменты Mikrotik для ИИ-агента: только чтение. Доступ к данным приходит
 * аргументом (mikrotikSource.js) и отдаёт конфигурацию уже вычищенной —
 * здесь её только режут на разделы, ищут и сравнивают.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const MAX_MATCHES = 200;
const DAYS = [1, 7, 30, 90];
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const errorResult = (text) => ({ isError: true, content: [{ type: "text", text }] });
const textResult = (text) => ({ content: [{ type: "text", text }] });
const clampInt = (value, min, max, fallback) =>
  Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
const lower = (value) => String(value || "").toLowerCase();

const DEVICE_RULE = {
  label: (d) => [d.name, d.label, d.host, d.serialNumber, d.company].filter(Boolean).join(" "),
  exact: (d) => [d.name, d.label, d.host, d.serialNumber].filter(Boolean),
};

// Устройство по id или имени. Ноль или несколько совпадений — ошибка с
// подсказкой: агент уточняет, а не читает чужой роутер.
const resolveDevice = (devices, value) => {
  const query = String(value || "").trim();
  if (OBJECT_ID.test(query)) {
    const device = devices.find((item) => item._id === query.toLowerCase());
    return device ? { device } : { error: `No Mikrotik device has id ${query}. Use list_mikrotik_devices.` };
  }
  const matches = resolveByName(devices, query, DEVICE_RULE);
  if (!matches.length) return { error: `No Mikrotik device matches "${query}". Use list_mikrotik_devices to see the names.` };
  if (matches.length > 1) {
    const options = matches.slice(0, 10).map((d) => `${safeLine(d.name)}${d.company ? ` (${d.company})` : ""} — id ${d._id}`).join("; ");
    return { error: `Several devices match "${query}": ${options}. Repeat with an id.` };
  }
  return { device: matches[0] };
};

// «ip firewall» → «/ip firewall»; раздел совпадает сам или как родитель.
const normalizeSection = (value) => `/${String(value).trim().replace(/^\/+/, "").replace(/\s+/g, " ")}`.toLowerCase();
const inSection = (path, wanted) => wanted === "/" || path === wanted || path.startsWith(`${wanted} `);

// Разница двух вычищенных конфигураций по разделам: строки как мультимножества.
const diffConfigs = (older, newer) => {
  const linesOf = (config) => new Map(config.sections.map((section) => [section.path, section.lines]));
  const before = linesOf(older);
  const after = linesOf(newer);
  const changes = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(path) || [];
    const right = after.get(path) || [];
    const count = new Map();
    for (const line of left) count.set(line, (count.get(line) || 0) + 1);
    const added = [];
    for (const line of right) {
      const seen = count.get(line) || 0;
      if (seen) count.set(line, seen - 1);
      else added.push(line);
    }
    const removed = left.filter((line) => {
      const rest = count.get(line) || 0;
      if (rest) count.set(line, rest - 1);
      return rest > 0;
    });
    // Комментарии экспорта (дата, «# poe-out status …») меняются сами по себе
    const meaningful = (lines) => lines.filter((line) => !line.startsWith("#"));
    if (meaningful(added).length || meaningful(removed).length) {
      changes.push({ path, added: meaningful(added), removed: meaningful(removed) });
    }
  }
  return changes;
};

const createMikrotikTools = ({ source, baseUrl, log }) => {
  const logCall = (caller, tool, meta, started) =>
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool, ...meta, durationMs: Date.now() - started });

  // Расположение живёт в карточках «Учёта техники»: без модуля его не читаем.
  const withLocations = (context) => ({ locations: Boolean(context?.modules?.inventory) });
  const searchText = (d) =>
    lower([d.name, d.label, d.host, d.serialNumber, d.boardName, d.company, ...(d.location?.path || []), d.location?.address, ...(d.location?.subdivisions || [])].join(" "));

  const list = async (args, caller, context) => {
    const started = Date.now();
    const devices = await source.listDevices(withLocations(context));
    const query = lower(args.query).trim();
    const company = lower(args.company).trim();
    const found = devices
      .filter((d) => !args.status || d.status === args.status)
      .filter((d) => !company || lower(d.company).includes(company))
      .filter((d) => !query || searchText(d).includes(query))
      .sort((a, b) => lower(a.company).localeCompare(lower(b.company)) || lower(a.name).localeCompare(lower(b.name)));
    const limit = clampInt(args.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
    logCall(caller, "list_mikrotik_devices", { found: found.length }, started);
    if (!found.length) return textResult(`No Mikrotik devices match (${devices.length} in total). Loosen the filters.`);
    const offline = found.filter((d) => d.status !== "online").length;
    const shown = found.slice(0, limit);
    return textResult(
      [
        `Found ${found.length} Mikrotik devices (${offline} offline); showing ${shown.length}; ${deviceLinkPattern(baseUrl)}.`,
        "",
        ...shown.map((device, index) => formatDeviceRow(device, index + 1, {})),
      ].join("\n"),
    );
  };

  const withDevice = async (args, run) => {
    const { device, error } = resolveDevice(await source.listDevices(), args.device);
    return error ? errorResult(error) : run(device);
  };

  const getDevice = (args, caller, context) =>
    withDevice(args, async (device) => {
      const started = Date.now();
      const days = DAYS.includes(args.days) ? args.days : 30;
      const detail = await source.loadDevice(device._id, { days, ...withLocations(context) });
      logCall(caller, "get_mikrotik_device", { deviceId: device._id, days }, started);
      if (!detail) return errorResult("The device is gone. Use list_mikrotik_devices.");
      return textResult(formatDeviceDetail(detail, { baseUrl, days, timezone: context?.timezone || "organisation timezone" }));
    });

  const getConfig = (args, caller) =>
    withDevice(args, async (device) => {
      const started = Date.now();
      const section = typeof args.section === "string" && args.section.trim() ? normalizeSection(args.section) : null;
      const search = lower(args.search).trim();
      const meta = { deviceId: device._id, section, search: search ? search.slice(0, 100) : undefined };
      let live;
      try {
        live = await source.readLiveConfig(device._id);
      } catch (error) {
        log("warn", "MCP: Mikrotik live read failed", { mcpKeyId: caller?.keyId, deviceId: device._id, error: error.message });
        logCall(caller, "get_mikrotik_config", { ...meta, failed: true }, started);
        return errorResult(
          `Could not read the configuration of ${safeLine(device.name)} from the device: ${source.describeLiveError(error) || "the device did not answer"}. Stored exports can still be compared with compare_mikrotik_exports.`,
        );
      }
      if (!live) return errorResult("The device is gone. Use list_mikrotik_devices.");
      const { config } = live;
      logCall(caller, "get_mikrotik_config", { ...meta, cached: live.cached, hidden: config.hidden }, started);

      const head = [
        `# Configuration of ${safeLine(device.name)}`,
        `read from the device at ${iso(live.fetchedAt)}${live.cached ? " (cached for up to 5 minutes)" : ""}; hidden values: ${config.hidden}`,
        `link: ${deviceLink(baseUrl, device._id)}`,
        "",
      ];
      const scope = section ? config.sections.filter((item) => inSection(item.path, section)) : config.sections;
      if (section && !scope.length) {
        return errorResult(`The configuration has no section ${section}. Call get_mikrotik_config without section to see the list.`);
      }
      if (search) {
        const matches = scope.flatMap((item) =>
          item.lines.filter((line) => lower(line).includes(search)).map((line) => ({ path: item.path, line })),
        );
        if (!matches.length) return textResult([...head, `No lines contain "${args.search.trim()}"${section ? ` in ${section}` : ""}.`].join("\n"));
        return textResult(
          [
            ...head,
            `${matches.length} lines contain "${args.search.trim()}"${matches.length > MAX_MATCHES ? `; showing the first ${MAX_MATCHES}` : ""}:`,
            ...formatConfigMatches(matches.slice(0, MAX_MATCHES)),
          ].join("\n"),
        );
      }
      if (!section) {
        return textResult([...head, ...formatConfigOutline(config), "", "Repeat with section (for example \"/ip firewall\") to read it, or with search."].join("\n"));
      }
      return textResult([...head, ...formatConfigSections(scope)].join("\n"));
    });

  const compare = (args, caller) =>
    withDevice(args, async (device) => {
      const started = Date.now();
      const exports = await source.listExports(device._id);
      const pick = (id, fallback) => (id ? exports.find((item) => item._id === String(id).toLowerCase()) : fallback);
      const picked = [pick(args.to, exports[0])];
      picked.push(pick(args.from, exports[exports.indexOf(picked[0]) + 1]));
      // Перепутанные местами from/to — не повод для ошибки: старший идёт первым
      const [older, newer] = picked.every(Boolean)
        ? [...picked].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        : [];
      if (exports.length < 2 && !(args.from && args.to)) {
        return errorResult(`${safeLine(device.name)} has ${exports.length} stored configuration export(s); two are needed to compare.`);
      }
      if (!newer || !older || newer === older) {
        return errorResult(
          [`Pick two different export ids of ${safeLine(device.name)} (from = older, to = newer):`, ...exports.map(formatExportRow)].join("\n"),
        );
      }
      const [before, after] = await Promise.all([
        source.loadExportConfig(device._id, older._id),
        source.loadExportConfig(device._id, newer._id),
      ]);
      if (!before || !after) return errorResult("The file of one of these exports is missing from storage. Pick other exports from get_mikrotik_device.");
      const changes = diffConfigs(before.config, after.config);
      logCall(caller, "compare_mikrotik_exports", { deviceId: device._id, from: older._id, to: newer._id, sections: changes.length }, started);
      const head = [
        `# Configuration changes of ${safeLine(device.name)}`,
        `from: ${iso(older.createdAt)} (export ${older._id}); to: ${iso(newer.createdAt)} (export ${newer._id})`,
        `link: ${deviceLink(baseUrl, device._id)}`,
        "",
      ];
      if (!changes.length) return textResult([...head, "No differences (secrets are hidden, so a changed password or key does not show)."].join("\n"));
      return textResult(
        [
          ...head,
          `${changes.length} sections changed; "-" lines were removed, "+" lines were added. Secrets are hidden, so a changed password or key does not show.`,
          ...formatConfigDiff(changes),
        ].join("\n"),
      );
    });

  return { list, getDevice, getConfig, compare };
};

module.exports = { createMikrotikTools, diffConfigs, resolveDevice, errorResult, textResult };
