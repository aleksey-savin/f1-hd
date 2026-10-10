const {
  STATE_COMMANDS,
  NETWORK_COMMANDS,
  LOG_WORDS,
  pingWords,
  traceWords,
  redactRow,
  pingTarget,
  namedEndpoints,
  filterLog,
  toInt,
  canonicalIp,
} = require("../mikrotik/liveState");
const { resolveDevice, errorResult, textResult } = require("./mikrotikTools");
const { deviceLink, safeLine } = require("./mikrotikFormat");
const { iso } = require("./text");

/**
 * Живая диагностика Mikrotik для ИИ-агента: состояние, ping с роутера,
 * журнал. На роутер уходят только команды из закрытого списка
 * (services/mikrotik/liveState.js); от агента — проверенный IPv4-адрес и
 * число пакетов. Доступ к роутеру приходит аргументом (mikrotikSource.js).
 */

const DEFAULT_CHECKS = ["interfaces", "tunnels", "routes"];
const STATE_TTL_MS = 30 * 1000;
const MAX_ROWS = 300;
const PING_TIMEOUT_MS = 20 * 1000;
const LOG_TIMEOUT_MS = 15 * 1000;
const PING_WINDOW_MS = 60 * 1000;
const MAX_PINGS = 10;

const quoteLine = (line) => `> ${line}`;
const formatValue = (value) => (value === "" || /\s/.test(value) ? `"${value.replace(/"/g, "'")}"` : value);

// Адрес другого управляемого устройства подписывается его именем.
const annotate = (value, book, ownName) => {
  const address = value.split("/")[0];
  const name = toInt(address) === null ? null : book.get(address);
  return name && name !== ownName ? ` (= ${safeLine(name)})` : "";
};

const formatRow = (path, row, book, ownName) =>
  quoteLine(
    Object.entries(redactRow(path, row))
      .map(([name, value]) => `${name}=${formatValue(value)}${annotate(value, book, ownName)}`)
      .join(" "),
  );

const formatSection = ({ title, words, keep }, result, book, ownName) => {
  if (result.error) return [`## ${title}: failed — ${safeLine(result.error)}`];
  const rows = (result.rows || []).filter((row) => !keep || keep(row));
  return [
    `## ${title} (${rows.length} ${rows.length === 1 ? "row" : "rows"})`,
    ...(rows.length ? rows.slice(0, MAX_ROWS).map((row) => formatRow(words[0], row, book, ownName)) : ["(empty)"]),
    ...(rows.length > MAX_ROWS ? [`[…${rows.length - MAX_ROWS} more rows not shown]`] : []),
  ];
};

const createMikrotikDiagnostics = ({ source, baseUrl, log, now = Date.now }) => {
  const stateCache = new Map(); // `${deviceId}|${check}` → { results, fetchedAt }
  const pings = new Map(); // deviceId → моменты последних ping

  const logCall = (caller, tool, meta, started) =>
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool, ...meta, durationMs: Date.now() - started });

  // Устройство по имени → run(device); сбой сессии — ошибка инструмента с причиной.
  const withDevice = async (args, caller, tool, run) => {
    const { device, error } = resolveDevice(await source.listDevices(), args.device);
    if (error) return errorResult(error);
    try {
      return await run(device);
    } catch (failure) {
      log("warn", "MCP: Mikrotik live read failed", { mcpKeyId: caller?.keyId, tool, deviceId: device._id, error: failure.message });
      return errorResult(
        `Could not reach ${safeLine(device.name)}: ${source.describeLiveError(failure) || "the device did not answer"}. Its last known status and outages are in get_mikrotik_device.`,
      );
    }
  };

  const GONE = "The device is gone. Use list_mikrotik_devices.";

  // Чтения одного устройства идут по очереди: второе такое же обращение
  // дождётся первого и возьмёт его ответ из кеша, а не пойдёт на роутер само.
  const deviceQueues = new Map();
  const inDeviceQueue = (deviceId, run) => {
    const tail = deviceQueues.get(deviceId) || Promise.resolve();
    const result = tail.then(run, run);
    const settled = result.catch(() => {});
    deviceQueues.set(deviceId, settled);
    settled.then(() => {
      if (deviceQueues.get(deviceId) === settled) deviceQueues.delete(deviceId);
    });
    return result;
  };

  // Проверки с живым кешем: на роутер идут только те, чей ответ устарел.
  // Найденное в кеше берётся сразу — чистка во время ожидания роутера его не тронет.
  const readChecks = (deviceId, checks, commandsOf) =>
    inDeviceQueue(deviceId, async () => {
      const moment = now();
      for (const [key, entry] of stateCache) {
        if (moment - entry.fetchedAt >= STATE_TTL_MS) stateCache.delete(key);
      }
      const found = new Map(checks.map((check) => [check, stateCache.get(`${deviceId}|${check}`)]));
      const stale = checks.filter((check) => !found.get(check));
      if (stale.length) {
        const commands = stale.flatMap((check) => commandsOf[check]);
        const results = await source.runOnDevice(
          deviceId,
          commands.map(({ title, words, timeoutMs, hideOwnSessions }) => ({ title, words, timeoutMs, hideOwnSessions })),
        );
        if (!results) return null;
        let offset = 0;
        for (const check of stale) {
          const count = commandsOf[check].length;
          const entry = { results: results.slice(offset, offset + count), fetchedAt: now() };
          stateCache.set(`${deviceId}|${check}`, entry);
          found.set(check, entry);
          offset += count;
        }
      }
      return { entries: checks.map((check) => found.get(check)), fresh: stale.length > 0 };
    });

  const state = (args, caller) =>
    withDevice(args, caller, "get_mikrotik_state", async (device) => {
      const started = Date.now();
      const checks = Array.isArray(args.checks) && args.checks.length
        ? [...new Set(args.checks)].filter((check) => STATE_COMMANDS[check])
        : DEFAULT_CHECKS;
      if (!checks.length) return errorResult(`Unknown checks. Use: ${Object.keys(STATE_COMMANDS).join(", ")}.`);
      const read = await readChecks(device._id, checks, STATE_COMMANDS);
      if (!read) return errorResult(GONE);
      const book = await source.loadAddressBook();
      const failed = read.entries.flatMap((entry) => entry.results).filter((result) => result.error).length;
      logCall(caller, "get_mikrotik_state", { deviceId: device._id, checks, cached: !read.fresh, failed }, started);
      const oldest = Math.min(...read.entries.map((entry) => entry.fetchedAt));
      return textResult(
        [
          `# Live state of ${safeLine(device.name)}`,
          `read from the device at ${iso(oldest)}${read.fresh ? "" : " (cached for up to 30 seconds)"}; checks: ${checks.join(", ")}`,
          `link: ${deviceLink(baseUrl, device._id)}`,
          ...checks.flatMap((check, index) =>
            STATE_COMMANDS[check].flatMap((command, at) => ["", ...formatSection(command, read.entries[index].results[at], book, device.name)]),
          ),
        ].join("\n"),
      );
    });

  const NETWORK_CHECK = { network: NETWORK_COMMANDS };
  const LOG_CHECK = { log: [{ title: "Log", words: LOG_WORDS, timeoutMs: LOG_TIMEOUT_MS, hideOwnSessions: true }] };
  const tooManyPings = (deviceId) => {
    const moment = now();
    const recent = (pings.get(deviceId) || []).filter((at) => moment - at < PING_WINDOW_MS);
    if (recent.length >= MAX_PINGS) {
      pings.set(deviceId, recent);
      return true;
    }
    pings.set(deviceId, [...recent, moment]);
    return false;
  };

  const ping = (args, caller) =>
    withDevice(args, caller, "ping_from_mikrotik", async (device) => {
      const started = Date.now();
      const given = typeof args.address === "string" ? args.address : "";
      // Дальше — только адрес, собранный из проверенного числа
      const address = toInt(given) === null ? given : canonicalIp(given);
      const meta = { deviceId: device._id, address: address.slice(0, 40), trace: Boolean(args.trace) };
      const refuse = (text) => {
        logCall(caller, "ping_from_mikrotik", { ...meta, refused: true }, started);
        return errorResult(text);
      };
      // Дешёвый отказ — до похода на роутер
      const shape = pingTarget(address, { extra: [address] });
      if (!shape.ok) return refuse(`Cannot ping "${safeLine(address).slice(0, 60)}": ${shape.reason}.`);

      const read = await readChecks(device._id, ["network"], NETWORK_CHECK);
      if (!read) return errorResult(GONE);
      const [addresses, routes, dns, peers, ...tunnels] = read.entries[0].results;
      if (addresses.error || routes.error) {
        return refuse(`Could not read the networks of ${safeLine(device.name)}, so the ping target cannot be checked: ${safeLine(addresses.error || routes.error)}.`);
      }
      const verdict = pingTarget(address, {
        addresses: addresses.rows,
        routes: routes.rows,
        extra: namedEndpoints({
          routes: routes.rows,
          dns: dns.rows || [],
          peers: peers.rows || [],
          remotes: tunnels.flatMap((result) => result.rows || []),
        }),
      });
      if (!verdict.ok) {
        const own = addresses.rows.map((row) => row.address).filter(Boolean).slice(0, 30).join(", ");
        return refuse(`Cannot ping ${address} from ${safeLine(device.name)}: ${verdict.reason}. Its networks: ${own || "none"}; routed networks are in get_mikrotik_state (routes).`);
      }
      if (tooManyPings(device._id)) {
        return refuse(`Too many pings from ${safeLine(device.name)}: at most ${MAX_PINGS} per minute. Try again in a minute.`);
      }

      const title = args.trace ? "Traceroute" : "Ping";
      const words = args.trace ? traceWords(address) : pingWords(address, args.count);
      const results = await source.runOnDevice(device._id, [{ title, words, timeoutMs: PING_TIMEOUT_MS }]);
      if (!results) return errorResult(GONE);
      logCall(caller, "ping_from_mikrotik", { ...meta, failed: Boolean(results[0].error) }, started);
      if (results[0].error) return errorResult(`${title} from ${safeLine(device.name)} to ${address} failed: ${safeLine(results[0].error)}.`);
      const rows = results[0].rows || [];
      return textResult(
        [
          `# ${title} from ${safeLine(device.name)} to ${address}`,
          `run on the device at ${iso(now())}; link: ${deviceLink(baseUrl, device._id)}`,
          "",
          ...(rows.length ? rows.slice(0, MAX_ROWS).map((row) => formatRow(words[0], row, new Map(), device.name)) : ["(the device returned no rows)"]),
        ].join("\n"),
      );
    });

  const readLog = (args, caller) =>
    withDevice(args, caller, "get_mikrotik_log", async (device) => {
      const started = Date.now();
      // Журнал кешируется как состояние: серия вопросов к нему — один заход
      const read = await readChecks(device._id, ["log"], LOG_CHECK);
      if (!read) return errorResult(GONE);
      const { results } = read.entries[0];
      if (results[0].error) {
        logCall(caller, "get_mikrotik_log", { deviceId: device._id, failed: true }, started);
        return errorResult(`Could not read the log of ${safeLine(device.name)}: ${safeLine(results[0].error)}.`);
      }
      const rows = filterLog(results[0].rows, args);
      logCall(caller, "get_mikrotik_log", { deviceId: device._id, lines: rows.length, cached: !read.fresh }, started);
      const head = [
        `# Log of ${safeLine(device.name)}`,
        `read from the device at ${iso(read.entries[0].fetchedAt)}${read.fresh ? "" : " (cached for up to 30 seconds)"}; times are the device's own clock; debug lines, script output and the helpdesk's own sessions are not shown`,
        `link: ${deviceLink(baseUrl, device._id)}`,
        "",
      ];
      if (!rows.length) return textResult([...head, "No log lines match."].join("\n"));
      return textResult(
        [...head, `${rows.length} ${rows.length === 1 ? "line" : "lines"}, oldest first:`, ...rows.map((row) => quoteLine(`${row.time} ${row.topics}: ${row.message}`))].join("\n"),
      );
    });

  return { state, ping, readLog };
};

module.exports = { createMikrotikDiagnostics };
