// Лог роутера для журнала устройства: что из /log/print ново с прошлого опроса и что из нового значимо.
// Чистый модуль: строки приходят аргументом, наружу — заготовки событий для services/mikrotik/events.js.
//
// Время события — время опроса (точность до пяти минут): часы роутера могут быть не выставлены,
// а его пояс HD не знает. Собственная метка роутера остаётся текстом в data.time.
const { scrubUrls } = require("./configRedact");
const { redactSecrets } = require("../secretsScanner");
const { dropOwnSessions } = require("./liveState");

const MAX_EVENTS = 50;
const MAX_LINES = 20;
const MAX_MESSAGE = 300;
const MAX_NAMES = 5;

const hasTopic = (topics, name) => String(topics || "").split(",").includes(name);
const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clean = (message) => oneLine(redactSecrets(scrubUrls(String(message || "")).text).text).slice(0, MAX_MESSAGE);

// «.id» строки лога — «*1A3F»: шестнадцатеричный счётчик, растёт до перезагрузки роутера
const rowId = (row) => {
  const id = Number.parseInt(String(row?.[".id"] || "").replace(/^\*/, ""), 16);
  return Number.isFinite(id) ? id : null;
};

/**
 * Новые строки с прошлого опроса.
 * Первое чтение только ставит курсор: прошлое роутера, случившееся до журнала, не импортируется
 * (у этих строк нет достоверного времени). Счётчик меньше курсора — роутер перезагружался,
 * буфер начат заново и все строки новые.
 */
function selectNew(rows, cursor) {
  const list = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, id: rowId(row) }))
    .filter((item) => item.id !== null)
    .sort((a, b) => a.id - b.id);
  if (!list.length) return { fresh: [], cursor: cursor ?? null };
  const max = list.at(-1).id;
  if (cursor === null || cursor === undefined) return { fresh: [], cursor: max };
  const fresh = max < cursor ? list : list.filter((item) => item.id > cursor);
  return { fresh: fresh.map((item) => item.row), cursor: max };
}

// RouterOS 6: «filter rule added by admin»; RouterOS 7: «… changed by tcp-msg(winbox):admin@10.0.0.9 (/ip firewall filter set …)»
const CONFIG = /\b(?:added|changed|removed|moved|enabled|disabled) by (\S+)/;
const LOGIN = /^user (\S+) logged in from (\S+) via (\S+)$/;
const LOGOUT = /^user \S+ logged out from /;
const LOGIN_FAILURE = /^login failure for user (\S*) from (\S+) via (\S+)$/;
// Системные сообщения, по которым восстанавливают историю устройства
const SYSTEM = /reboot|shutdown|power|upgrad|downgrad|install|reset|watchdog|kernel failure|out of memory/i;

const configUser = (token) => {
  const at = token.lastIndexOf("@");
  const who = at > 0 ? token.slice(0, at) : token;
  return who.slice(who.lastIndexOf(":") + 1) || token;
};
const pushName = (list, value) => {
  if (value && !list.includes(value) && list.length < MAX_NAMES) list.push(value);
};

/**
 * Заготовки событий из новых строк, в порядке лога.
 * Подряд идущие правки одной учётной записи — одно событие; все неудачные входы опроса — одно.
 * hdUser — учётная запись HD на роутере: её входы по API и SSH (сам опрос) отбрасываются.
 */
function toEvents(rows, { hdUser } = {}) {
  const events = [];
  let failures = null;
  for (const row of dropOwnSessions(rows, hdUser)) {
    if (hasTopic(row.topics, "debug") || hasTopic(row.topics, "script")) continue;
    const message = clean(row.message);
    if (!message || LOGOUT.test(message)) continue;
    const time = oneLine(row.time);

    const failure = LOGIN_FAILURE.exec(message);
    if (failure) {
      if (!failures) {
        failures = { kind: "routerLoginFailed", data: { count: 0, users: [], sources: [], via: [] } };
        events.push(failures);
      }
      failures.data.count += 1;
      pushName(failures.data.users, failure[1]);
      pushName(failures.data.sources, failure[2]);
      pushName(failures.data.via, failure[3]);
      continue;
    }

    const login = LOGIN.exec(message);
    if (login) {
      events.push({ kind: "routerLogin", actor: { type: "routerUser", name: login[1] }, data: { from: login[2], via: login[3], time } });
      continue;
    }

    const config = CONFIG.exec(message);
    if (config) {
      const name = configUser(config[1]);
      const last = events.at(-1);
      if (last?.kind === "routerConfig" && last.actor.name === name) {
        last.data.count += 1;
        if (last.data.lines.length < MAX_LINES) last.data.lines.push(message);
      } else {
        events.push({
          kind: "routerConfig",
          actor: { type: "routerUser", name },
          data: { count: 1, lines: [message], time, ...(name === hdUser ? { byHd: true } : {}) },
        });
      }
      continue;
    }

    if (hasTopic(row.topics, "critical") || hasTopic(row.topics, "error")) {
      events.push({ kind: "routerCritical", data: { message, time } });
      continue;
    }
    if (hasTopic(row.topics, "system") && SYSTEM.test(message)) {
      events.push({ kind: "routerSystem", data: { message, time } });
    }
  }
  if (events.length <= MAX_EVENTS) return events;
  return [...events.slice(0, MAX_EVENTS), { kind: "routerMore", data: { count: events.length - MAX_EVENTS } }];
}

module.exports = { selectNew, toEvents, rowId, MAX_EVENTS, MAX_LINES };
