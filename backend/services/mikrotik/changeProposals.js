// Приём предложения ИИ-агента: проверка, сверка с живым роутером (только чтение), запись запроса.
// На роутер ничего не пишет. Модели трогает только mongoStore; logger не подключаем — здесь его нет.
const { validateProposal, PLACEHOLDERS } = require("./changeRules");
const { displayCommand, hasForbiddenChars } = require("./changeRender");
const { STATUS, planSteps, isFinal } = require("./changeSteps");
const { norm, matches, redactedBefore } = require("./changeMatch");
const { maskText } = require("../mcp/maskText");

const MAX_TITLE = 200;
const MAX_REASON = 1000;
const MAX_OPEN = 5;
const MAX_PER_HOUR = 20;
// Любые попытки ключа, включая отказы: каждая после проверки формы стоит входа на роутер
const MAX_ATTEMPTS_PER_HOUR = 60;
const TTL_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

// Поля, которых у строк может не быть в ответе API (пустые и служебные не печатаются)
const OPTIONAL_PARAMS = new Set(["comment", "disabled", "timeout", "place-before", "copy-from"]);
// Что считается «уже есть» при add; для прочих разделов роутер откажет сам
const UNIQUE_KEYS = {
  "/ip firewall address-list": ["list", "address"],
  "/ip dns static": ["name", "address"],
  "/ip dhcp-server lease": ["address"],
  "/interface wireguard peers": ["public-key"],
};
const FIREWALL = new Set(["/ip firewall filter", "/ip firewall raw", "/ipv6 firewall filter", "/ipv6 firewall raw"]);
const FIREWALL_REASON = "changes input firewall rules: may cut off the device";
const PLACEHOLDER_VALUES = new Set(Object.values(PLACEHOLDERS));

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// «/interface wireguard peers» → слова API-чтения раздела
const printWords = (path) => [`${path.replace(/ /g, "/")}/print`];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const isIpv4 = (value, { prefix }) => {
  const m = typeof value === "string" ? IPV4.exec(value) : null;
  if (!m || m.slice(1, 5).some((o) => Number(o) > 255)) return false;
  if (m[5] !== undefined) return prefix && Number(m[5]) <= 32;
  return true;
};
const IFACE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

// Форма wireguardClient → список ошибок
function checkWireguardClient(w) {
  if (!isPlainObject(w)) return ["wireguardClient must be an object"];
  const errors = [];
  if (typeof w.interface !== "string" || !IFACE.test(w.interface)) errors.push("wireguardClient.interface must be an interface name");
  if (!isIpv4(w.address, { prefix: true })) errors.push("wireguardClient.address must be an IPv4 address or IPv4/prefix");
  if (!Array.isArray(w.allowedIps) || w.allowedIps.length < 1 || w.allowedIps.length > 10 || !w.allowedIps.every((v) => isIpv4(v, { prefix: true }))) {
    errors.push("wireguardClient.allowedIps must be 1-10 IPv4 addresses or IPv4/prefix");
  }
  const dns = w.dns === undefined ? [] : w.dns;
  if (!Array.isArray(dns) || dns.length > 3 || !dns.every((v) => isIpv4(v, { prefix: false }))) errors.push("wireguardClient.dns must be up to 3 IPv4 addresses");
  if (w.endpoint !== undefined && w.endpoint !== null && w.endpoint !== "") {
    const m = typeof w.endpoint === "string" && !hasForbiddenChars(w.endpoint) ? /^(.+):(\d{1,5})$/.exec(w.endpoint) : null;
    const port = m ? Number(m[2]) : 0;
    if (!m || port < 1 || port > 65535 || !(isIpv4(m[1], { prefix: false }) || HOSTNAME.test(m[1]))) {
      errors.push("wireguardClient.endpoint must be host:port (IPv4 or hostname)");
    }
  }
  return errors;
}

const needsPeerError = (w, commands) =>
  commands.some(
    (c) => c.action === "add" && c.path === "/interface wireguard peers" && c.params["public-key"] === PLACEHOLDERS.publicKey && c.params.interface === w.interface,
  )
    ? null
    : `wireguardClient needs a peer with ${PLACEHOLDERS.publicKey}: add a command to /interface wireguard peers with public-key=${PLACEHOLDERS.publicKey} and interface=${w.interface}`;

// Текст агента: обязателен, ограничен по длине, без запретных символов, проходит maskText
function checkText(name, value, max, errors) {
  if (typeof value !== "string" || !value.trim()) return errors.push(`${name} is required`), null;
  if (value.length > max) return errors.push(`${name} must be at most ${max} characters`), null;
  if (hasForbiddenChars(value)) return errors.push(`${name} contains forbidden characters (control, line breaks, invisible or bidi characters)`), null;
  return maskText(value.trim());
}

const WG_PEERS = "/interface wireguard peers";
const usesPlaceholder = (c) => Object.values(c.params || {}).some((v) => PLACEHOLDER_VALUES.has(v));

function createProposals({ store, readMenus, now = () => new Date() }) {
  // Попытки по ключам за последний час (в памяти процесса)
  const attempts = new Map();
  // Очередь на ключ: пока предыдущий не закончил, следующий ждёт. Запись удаляется, когда цепочка иссякла.
  const tails = new Map();
  const withLock = (key, fn) => {
    const run = (tails.get(key) || Promise.resolve()).then(fn);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };

  async function propose(input, caller) {
    // reasons: фразы HD; чужой текст (роутер, имена устройств) — отдельно в quoted, error — строка для совместимости
    const refuse = (errors) => {
      const reasons = [].concat(errors).map((r) => (typeof r === "string" ? { text: r } : r));
      return { ok: false, error: reasons.map((r) => (r.quoted ? `${r.text}: ${r.quoted}` : r.text)).join("; "), reasons };
    };
    if (!isPlainObject(input)) return refuse("proposal must be an object");
    if (!caller || !caller.keyId) return refuse("caller (MCP key) is required");
    const since = now().getTime() - HOUR_MS;
    const recent = (attempts.get(String(caller.keyId)) || []).filter((t) => t > since);
    if (recent.length >= MAX_ATTEMPTS_PER_HOUR) {
      attempts.set(String(caller.keyId), recent);
      return refuse(`too many attempts from this key in the last hour (${MAX_ATTEMPTS_PER_HOUR}): wait before proposing again`);
    }
    attempts.set(String(caller.keyId), [...recent, now().getTime()]);

    // 1. Форма
    const errors = [];
    const device = typeof input.device === "string" ? input.device.trim() : "";
    if (!device) errors.push("device is required (name or id)");
    const telegramId = typeof input.requester === "number" ? String(input.requester) : input.requester;
    if (typeof telegramId !== "string" || !/^\d{1,20}$/.test(telegramId)) errors.push("requester must be the Telegram id of an employee (digits)");
    const title = checkText("title", input.title, MAX_TITLE, errors);
    const reason = checkText("reason", input.reason, MAX_REASON, errors);
    const checked = validateProposal(input);
    if (!checked.ok) errors.push(...checked.errors);
    else if (input.wireguardClient !== undefined && input.wireguardClient !== null) {
      const shape = checkWireguardClient(input.wireguardClient);
      errors.push(...shape);
      const peer = shape.length ? null : needsPeerError(input.wireguardClient, checked.commands);
      if (peer) errors.push(peer);
    }
    if (checked.ok) {
      const wg = input.wireguardClient;
      const allowed = (c) => wg && isPlainObject(wg) && c.action === "add" && c.path === WG_PEERS && c.params.interface === wg.interface;
      const withPlaceholder = checked.commands.filter(usesPlaceholder);
      if (withPlaceholder.some((c) => !allowed(c))) errors.push("placeholders are only allowed in the WireGuard peer added for wireguardClient");
      else if (withPlaceholder.length > 1) errors.push("only one command may use placeholders (one WireGuard client config per request)");
    }
    if (errors.length) return refuse(errors);

    // 2. Устройство и заявитель
    const found = await store.findDevice(device);
    if (found.error) return refuse(found.quoted ? { text: found.error, quoted: found.quoted } : found.error);
    const mikrotik = found.device;
    const requester = await store.findUserByTelegram(telegramId);
    if (requester?.error) return refuse(requester.error);
    if (!requester) {
      return refuse("no employee with this Telegram id: the person must be an active, non-banned staff member with a linked Telegram");
    }

    // 3. Кто решает
    const responsibleId = mikrotik.responsibleId || null;
    const plan = planSteps({
      requesterId: requester._id,
      responsibleId,
      requesterCanApprove: await store.canApprove(requester._id),
      responsibleCanApprove: responsibleId ? await store.canApprove(responsibleId) : false,
    });
    if (!plan.ok) return refuse(plan.reason);

    // Остальное — под замком ключа и устройства: пределы считаются и пишутся без гонки
    return withLock(`key:${caller.keyId}`, () => withLock(`device:${mikrotik._id}`, () => reconcileAndCreate()));

    async function reconcileAndCreate() {
    const at = now();
    const limit = async () => {
      if ((await store.countOpen(mikrotik._id)) >= MAX_OPEN) {
        return `too many open requests on this device (${MAX_OPEN}): wait until some are decided`;
      }
      if ((await store.countRecentByKey(caller.keyId, new Date(at.getTime() - HOUR_MS))) >= MAX_PER_HOUR) {
        return `too many proposals from this key in the last hour (${MAX_PER_HOUR})`;
      }
      return null;
    };
    const early = await limit();
    if (early) return refuse(early);

    // 5. Сверка с роутером: раздел читается один раз
    const paths = [...new Set(checked.commands.map((c) => c.path))];
    let read;
    try {
      read = await readMenus(mikrotik._id, paths);
    } catch (error) {
      return refuse({ text: "could not read the device", quoted: String(error?.message || "failed") });
    }
    const menus = new Map();
    const problems = [];
    for (const path of paths) {
      const got = read.get(path);
      const first = checked.commands.findIndex((c) => c.path === path) + 1;
      if (got && got.rows) menus.set(path, got.rows);
      else if (got?.menu) problems.push({ text: `command ${first}: menu "${path}" cannot be read on this device`, quoted: String(got.error) });
      else return refuse({ text: "could not read the device", quoted: String(got?.error || "no answer") });
    }
    if (problems.length) return refuse(problems);

    const commands = [];
    checked.commands.forEach((command, index) => {
      const n = index + 1;
      const rows = menus.get(command.path);
      const known = new Set(rows.flatMap((row) => Object.keys(row)));
      const out = { ...command, before: null, rowId: null, result: { state: "pending" } };
      const unknown = (where) =>
        Object.entries(where || {}).filter(([name, value]) => !known.has(name) && !OPTIONAL_PARAMS.has(name) && !PLACEHOLDER_VALUES.has(value)).map(([name]) => name);

      if (rows.length) {
        for (const name of Object.keys(command.where || {})) if (!known.has(name)) problems.push(`command ${n}: unknown field "${name}" in where`);
        if (command.action === "add" || command.action === "set") {
          for (const name of unknown(command.params)) problems.push(`command ${n}: unknown field "${name}" in params`);
        }
      }

      if (command.action === "add") {
        const keys = UNIQUE_KEYS[command.path];
        if (keys && keys.every((k) => command.params[k] !== undefined && !PLACEHOLDER_VALUES.has(command.params[k]))) {
          if (rows.some((row) => keys.every((k) => row[k] !== undefined && norm(row[k]) === norm(command.params[k])))) {
            problems.push(`command ${n}: an entry with ${keys.map((k) => `${k}=${command.params[k]}`).join(" ")} already exists in ${command.path}`);
          }
        }
      } else {
        const hit = rows.filter((row) => matches(row, command.where));
        if (hit.length !== 1) {
          problems.push(
            hit.length
              ? `command ${n}: where matches ${hit.length} rows in ${command.path}; it must match exactly one`
              : `command ${n}: where matches no row in ${command.path}`,
          );
        } else {
          out.rowId = hit[0][".id"] || null;
          out.before = redactedBefore(command.path, hit[0]);
          // Команда, которая ничего не меняет, при проверке читается как «на месте» и превращает чистый откат
          // в «требует проверки»: такие не принимаются
          const row = hit[0];
          const idle =
            command.action === "set" ? Object.entries(command.params).every(([name, value]) => row[name] !== undefined && norm(row[name]) === norm(value))
            : command.action === "enable" ? norm(row.disabled ?? "no") === "no"
            : command.action === "disable" ? norm(row.disabled ?? "no") === "yes"
            : false;
          if (idle) problems.push(`command ${n} changes nothing (the row already has these values)`);
          // Риск firewall — по настоящей строке, а не по догадке до сверки
          if (FIREWALL.has(command.path)) {
            const moves = String(command.params?.chain ?? "").trim().toLowerCase();
            const input = String(hit[0].chain).toLowerCase() === "input" || moves === "input" || moves.startsWith("!");
            out.risk = input ? "high" : "normal";
            out.riskReason = input ? FIREWALL_REASON : null;
          }
        }
      }
      try {
        out.text = displayCommand(command);
      } catch (error) {
        problems.push(`command ${n}: ${error.message}`);
      }
      commands.push(out);
    });
    // Одна строка — одна команда; два add одного уникального ключа внутри запроса
    const seen = new Map();
    const keyed = new Map();
    commands.forEach((c, i) => {
      if (c.rowId) {
        const key = `${c.path}\n${c.rowId}`;
        if (seen.has(key)) problems.push(`commands ${seen.get(key)} and ${i + 1} target the same row`);
        else seen.set(key, i + 1);
      }
      const keys = UNIQUE_KEYS[c.path];
      if (c.action === "add" && keys && keys.every((k) => c.params[k] !== undefined && !PLACEHOLDER_VALUES.has(c.params[k]))) {
        const key = `${c.path}\n${keys.map((k) => norm(c.params[k])).join("\n")}`;
        if (keyed.has(key)) problems.push(`commands ${keyed.get(key)} and ${i + 1} add the same entry (${keys.map((k) => `${k}=${c.params[k]}`).join(" ")})`);
        else keyed.set(key, i + 1);
      }
    });
    if (problems.length) return refuse(problems);

    // Пока читали роутер, пределы могли исчерпаться
    const late = await limit();
    if (late) return refuse(late);

    // 6. Запись
    const first = plan.steps[0].role === "requester" ? STATUS.awaitingRequester : STATUS.awaitingResponsible;
    const doc = {
      number: await store.nextNumber(),
      mikrotik: mikrotik._id,
      title,
      reason,
      requestedBy: requester._id,
      requestedVia: { keyId: caller.keyId, keyName: caller.keyName },
      responsible: responsibleId,
      commands,
      risk: commands.some((c) => c.risk === "high") ? "high" : "normal",
      status: first,
      expiresAt: new Date(at.getTime() + TTL_MS),
      steps: plan.steps.map((s) => ({ role: s.role, user: s.user, decision: null })),
      timeline: [{ at, kind: "proposed", user: requester._id, text: `Агент ${caller.keyName} предложил изменение` }],
    };
    if (input.wireguardClient) {
      const w = input.wireguardClient;
      doc.wireguard = { client: { interface: w.interface, address: w.address, allowedIps: [...w.allowedIps], dns: [...(w.dns || [])], ...(w.endpoint ? { endpoint: w.endpoint } : {}) } };
    }
    return { ok: true, change: await store.create(doc) };
    }
  }
  return { propose };
}

// --- Единственное место с моделями; подключаются лениво, чтобы модуль грузился без базы ---

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const same = (a, b) => String(a || "").trim().toLowerCase() === b;

const mongoStore = {
  async findDevice(value) {
    const Mikrotik = require("@/models/mikrotik");
    const query = String(value || "").trim();
    if (OBJECT_ID.test(query)) {
      const d = await Mikrotik.findById(query).select("name responsibleId").lean();
      if (d) return { device: { _id: d._id, name: d.name, responsibleId: d.responsibleId || null } };
      // 24 шестнадцатеричных знака могут быть и серийным номером или именем — ищем дальше как обычно
    }
    const all = await Mikrotik.find({}).select("name label serialNumber credentials.host responsibleId").lean();
    const q = query.toLowerCase();
    const hits = all.filter((d) => [d.name, d.label, d.credentials?.host, d.serialNumber].some((v) => v && same(v, q)));
    if (!hits.length) return { error: `No Mikrotik device matches "${query}". Use list_mikrotik_devices to see the names.` };
    if (hits.length > 1) {
      return { error: "Several devices match the name. Repeat with an id.", quoted: `"${query}": ${hits.slice(0, 10).map((d) => `${d.name || d.label} (id ${d._id})`).join(", ")}` };
    }
    const d = hits[0];
    return { device: { _id: d._id, name: d.name || d.label, responsibleId: d.responsibleId || null } };
  },
  // Сотрудник (не клиент, не служебная учётка), не заблокирован, Telegram привязан и активен;
  // двое с одним id — отказ, а не выбор наугад
  async findUserByTelegram(id) {
    const User = require("@/models/user");
    const { isBanned } = require("@/services/authBan");
    const users = await User.find({ "telegramBot.chatId": String(id), "telegramBot.isActive": true, isEndUser: false, isServiceAccount: { $ne: true } }).limit(10).lean();
    const fit = users.filter((u) => !isBanned(u) && String(u.telegramBot?.chatId) === String(id));
    if (fit.length > 1) return { error: "more than one employee has this Telegram id" };
    return fit[0] ? { _id: fit[0]._id, name: fit[0].name } : null;
  },
  // Право держит действующий сотрудник; по ролям считает canFor (полный документ обязателен)
  async canApprove(userId) {
    const User = require("@/models/user");
    const { isBanned } = require("@/services/authBan");
    const { canFor } = require("@/services/permissions");
    const user = await User.findById(userId).lean();
    if (!user || user.isEndUser !== false || user.isServiceAccount === true || isBanned(user)) return false;
    return Boolean((await canFor(user))({ mikrotik: ["approveChanges"] }));
  },
  async countOpen(deviceId) {
    const MikrotikChange = require("@/models/mikrotikChange");
    const open = Object.values(STATUS).filter((s) => !isFinal(s));
    return MikrotikChange.countDocuments({ mikrotik: deviceId, status: { $in: open } });
  },
  async countRecentByKey(keyId, since) {
    const MikrotikChange = require("@/models/mikrotikChange");
    return MikrotikChange.countDocuments({ "requestedVia.keyId": keyId, createdAt: { $gte: since } });
  },
  async nextNumber() {
    return require("@/models/mikrotikChange").nextMikrotikChangeNumber();
  },
  async create(doc) {
    const created = await require("@/models/mikrotikChange").create(doc);
    return created.toObject();
  },
};

// Ошибки runCommands, не относящиеся к самому разделу: роутер не ответил
const NOT_THE_MENU = /^(the device did not answer in time|not run: an earlier command did not answer)/;

// Чтение разделов по API одной сессией: Map путь → { rows } | { error, menu }.
// menu=true — роутер ответил ошибкой на раздел (нет такого меню); сбой сессии — throw.
async function liveReadMenus(deviceId, paths) {
  const { runOnDevice, describeLiveError } = require("@/services/mcp/mikrotikSource");
  let results;
  try {
    results = await runOnDevice(deviceId, paths.map((path) => ({ title: path, words: printWords(path) })));
  } catch (error) {
    // Код и признак «может пройти» нужны воркеру применения: ждать или отказать сразу
    const { isTransientPollError } = require("@/services/mikrotik/connector");
    throw Object.assign(new Error(describeLiveError(error) || "the device did not answer"), {
      code: error?.code,
      // Адрес запрещён навсегда; его имя в тексте не должно сбить классификатор по словам
      transient: error?.code !== "MIKROTIK_BLOCKED_HOST" && isTransientPollError(error),
    });
  }
  if (!results) throw new Error("the device is gone");
  return new Map(
    paths.map((path, i) => {
      const r = results[i];
      if (r && r.error === undefined) return [path, { rows: r.rows || [] }];
      const error = String(r?.error || "no answer");
      return [path, { error, menu: !NOT_THE_MENU.test(error) }];
    }),
  );
}

module.exports = { createProposals, mongoStore, liveReadMenus, printWords };
