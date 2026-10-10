// Уведомления о запросах ИИ-агента на изменение Mikrotik: Telegram (с кнопками), колокольчик, почта.
// Чистый модуль: зависимости (пользователи, запись, колокольчик) приходят аргументами, логгер и модели при загрузке не подключаем.
// Тексты собираются обычным текстом; в Telegram и в письмо уходят HTML-экранированными, в колокольчик — как есть.
// Команды показываются только через сохранённый `text`.
const { STATUS } = require("./changeSteps");
const { currentStep } = require("./changeSteps");
const { diffRows } = require("./changeRender");
const { escapeHtml } = require("../telegramMessage");
const { rollbackAvailable } = require("./changeExecutorMode");

const CATEGORY = "mikrotikChange";
const MAX_LENGTH = 3500;
const DEFAULT_TZ = "Europe/Moscow";
// Одна фраза про откат: если проверка на живом роутере покажет, что откат не работает, правится здесь.
const ROLLBACK_NOTE = "Если команда не пройдёт или связь пропадёт, роутер откатит изменения сам.";
// Режим api (MIKROTIK_CHANGE_EXECUTOR): safe mode нет, отката нет — обещать его нельзя. Строка целиком, вместе с копией.
const NO_ROLLBACK_NOTE = "HD снимет резервную копию. Автоматического отката нет: если команда не пройдёт, уже применённое останется — смотрите результат по командам.";
// Итог отката — то же обещание, что и ROLLBACK_NOTE: менять вместе.
const ROLLED_BACK_NOTE = "Одна из команд не прошла, роутер вернул прежнюю конфигурацию.";
const HIGH_RISK_NOTE = "Может оборвать связь с устройством";

const HARD_LIMIT = 4000;
// Чужой текст (агент, роутер, человек) — в одну строку и с потолком: иначе перевод строки подделывает чужие строки сообщения.
const oneLine = (text, max) => {
  // \s не знает NEL и разделителей U+001C–U+001F — для подписи это тоже переводы строки
  const t = String(text ?? "").replace(/[\s\u0085\u001c-\u001f]+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const usable = (user) => Boolean(user) && user.isServiceAccount !== true && user.banned !== true;

const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
const personName = (user) => oneLine([user?.firstName, user?.lastName].filter(Boolean).join(" "), 80);
const pathOf = (change) => `/devices/mikrotik/changes/${idOf(change)}`;

// --- время

const tzOf = (ctx) => ctx?.timezone || DEFAULT_TZ;
const parts = (date, tz) => {
  const out = {};
  for (const p of new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(date))) out[p.type] = p.value;
  return out;
};
const clock = (date, ctx) => {
  const p = parts(date, tzOf(ctx));
  return `${p.hour}:${p.minute}`;
};
const dayMonth = (date, ctx) => {
  const p = parts(date, tzOf(ctx));
  return `${p.day}.${p.month}`;
};
const dayIndex = (date, tz) => {
  const p = parts(date, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000;
};
const expiresText = (change, ctx) => {
  if (!change.expiresAt) return "";
  const tz = tzOf(ctx);
  const diff = dayIndex(change.expiresAt, tz) - dayIndex(ctx?.now || new Date(), tz);
  const at = clock(change.expiresAt, ctx);
  if (diff === 0) return `Истекает сегодня в ${at}.`;
  if (diff === 1) return `Истекает завтра в ${at}.`;
  return `Истекает ${dayMonth(change.expiresAt, ctx)} в ${at}.`;
};

// --- ссылки и кнопки

// Telegram отвергает кнопку-ссылку не на https и на localhost, и роняет всё сообщение: тогда ссылки нет совсем.
const buttonUrl = (baseUrl, change) => {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base) || /^https:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(base)) return null;
  return `${base}${pathOf(change)}`;
};
const mailUrl = (baseUrl, change) => {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return base ? `${base}${pathOf(change)}` : null;
};

function stepKeyboard(change, fits, { baseUrl } = {}) {
  const rows = [];
  if (fits) {
    const step = currentStep(change);
    const label = step?.role === "requester" && change.steps.length > 1 ? "Подтвердить" : "Утвердить";
    const id = idOf(change);
    rows.push([
      { text: label, callback_data: `mc:a:${id}` },
      { text: "Отклонить", callback_data: `mc:r:${id}` },
    ]);
  }
  const url = buttonUrl(baseUrl, change);
  if (url) rows.push([{ text: "Открыть в HD", url }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

// Клавиатура итога: решений нет, только ссылка.
const linkKeyboard = (change, baseUrl) => stepKeyboard(change, false, { baseUrl });

const confirmKeyboard = (change) => ({
  inline_keyboard: [[
    { text: "Да, применить", callback_data: `mc:y:${idOf(change)}` },
    { text: "Назад", callback_data: `mc:b:${idOf(change)}` },
  ]],
});

// --- тексты

const head = (ctx) => [oneLine(ctx.deviceName, 80), oneLine(ctx.companyName, 80)].filter(Boolean).join(", ");
const titleOf = (change) => oneLine(change.title, 200);

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const commandsWord = (n) => `${n} ${plural(n, "команда", "команды", "команд")}`;

// Жёсткий потолок Telegram: список команд уже сокращён, остаток режем с многоточием.
// Длина считается как у экранированного текста: именно он уходит в Telegram первым.
const wireLength = (text) => escapeHtml(text).length;
const clamp = (text) => {
  if (wireLength(text) <= HARD_LIMIT) return text;
  let cut = Math.min(text.length, HARD_LIMIT - 1);
  while (cut > 0 && wireLength(`${text.slice(0, cut)}…`) > HARD_LIMIT) cut = Math.floor(cut * 0.9);
  return `${text.slice(0, cut).trimEnd()}…`;
};

// Сколько знаков команды и значения «было» показывается. Под кнопками решения ничего не режется:
// что длиннее — не показывается вовсе, а сообщение считается непомещающимся (решать вслепую нельзя).
const COMMAND_MAX = 600;
const WAS_MAX = 120;
const flat = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// Строки одной команды и признак whole: показана целиком, без единой обрезки
function commandLines(change, index) {
  const command = change.commands[index];
  // Текст команды показывается как сохранён: пробелы внутри значений — часть того, что уйдёт на роутер.
  // Переводов строки в нём нет (значения проверены при приёме); на случай иного — они заменяются пробелом
  const text = String(command.text ?? "").replace(/[\r\n\t\v\f\u0085\u2028\u2029\u001c-\u001f]/g, " ").trim();
  let whole = text.length <= COMMAND_MAX;
  const lines = [`${index + 1}. ${whole ? text : oneLine(text, COMMAND_MAX)}`];
  if (command.action === "set") {
    const rows = diffRows(command, command.before);
    if (rows.some((r) => flat(r.field).length > WAS_MAX || flat(r.from).length > WAS_MAX)) whole = false;
    if (rows.length) lines.push(`   было: ${rows.map((r) => `${oneLine(r.field, WAS_MAX)}=${oneLine(r.from, WAS_MAX)}`).join(" ")}`);
  }
  return { text: lines.join("\n"), whole };
}

function stepMessage(change, ctx) {
  const total = change.commands.length;
  const first = (change.steps || [])[0];
  const requesterStep = first && first.role === "requester" && first.decision === "approve" && first.decidedAt && currentStep(change)?.role === "responsible";
  const asks = `Просит: ${oneLine(ctx.requesterName, 80)}${requesterStep ? ` (подтвердил в ${clock(first.decidedAt, ctx)})` : ""}`;
  const top = [
    ...(ctx.prefix ? [ctx.prefix, ""] : []),
    `Запрос на изменение конфигурации`,
    head(ctx),
    "",
    titleOf(change),
    asks,
    ...(ctx.agentName ? [`Агент: ${oneLine(ctx.agentName, 60)}`] : []),
    "",
    ...(change.risk === "high" ? [HIGH_RISK_NOTE, ""] : []),
  ];
  const tail = ["", `Риск ${change.risk === "high" ? "высокий" : "обычный"}. ${expiresText(change, ctx)}`.trim()];
  const all = change.commands.map((_, i) => commandLines(change, i));
  // Показываются только целые команды подряд с первой: обрезанной под кнопками решения быть не должно
  const firstCut = all.findIndex((c) => !c.whole);
  const showable = firstCut === -1 ? total : firstCut;
  const compose = (count) => {
    const more = total - count;
    const lines = [...top, `Команды (${total}):`, ...all.slice(0, count).map((c) => c.text)];
    if (more > 0) lines.push(`…и ещё ${more} — откройте запрос в HD`);
    return lines.join("\n") + (more > 0 ? "" : tail.join("\n"));
  };
  if (showable === total && wireLength(compose(total)) <= MAX_LENGTH) return { text: compose(total), fits: true };
  let count = Math.min(showable, total - 1);
  while (count > 0 && wireLength(compose(count)) > MAX_LENGTH) count--;
  return { text: clamp(compose(count)), fits: false };
}

// Все команды списком — для шага подтверждения, где их нельзя прятать
const commandsBlock = (change) =>
  [`Команды (${change.commands.length}):`, ...change.commands.map((_, i) => commandLines(change, i).text)].join("\n");
const allWhole = (change) => change.commands.every((_, i) => commandLines(change, i).whole);

function confirmText(change, ctx) {
  return [
    `Запрос на изменение конфигурации, ${head(ctx)}`,
    titleOf(change),
    "",
    `Применить ${commandsWord(change.commands.length)} на роутере?`,
    (ctx?.rollback ?? rollbackAvailable()) ? `HD снимет резервную копию. ${ROLLBACK_NOTE}` : NO_ROLLBACK_NOTE,
  ].join("\n");
}

// Сообщение шага подтверждения: вопрос и те же команды. Не влезло в потолок Telegram или хоть одна
// команда не показывается целиком — null (утверждать вслепую нельзя).
function confirmFull(change, ctx) {
  if (!allWhole(change)) return null;
  const text = `${confirmText(change, ctx)}\n\n${commandsBlock(change)}`;
  return wireLength(text) > HARD_LIMIT ? null : text;
}

const decided = (change) => (change.steps || []).filter((s) => s.decision);
const nameOf = (id, ctx) => personName(ctx.users?.get(idOf(id)));
const quoted = (text) => (oneLine(text, 300) ? `«${oneLine(text, 300)}»` : "");
// Ответом роутера подписывается только его отказ (result.refused); остальное — слова HD
const routerSays = (text) => (oneLine(text, 300) ? `Роутер ответил: ${oneLine(text, 300)}` : "");
const notConfirmed = (text) => (oneLine(text, 300) ? `Не подтверждена: ${oneLine(text, 300)}` : "");
const ATTENTION_NOTE = "HD не может поручиться за состояние устройства — проверьте его вручную.";

// Краткая суть итога: для колокольчика и для тела сообщения.
function resultFacts(change, ctx) {
  const n = change.commands.length;
  switch (change.status) {
    case STATUS.applied: {
      return { summary: `${n} ${plural(n, "команда выполнена", "команды выполнены", "команд выполнено")}, устройство отвечает.` };
    }
    case STATUS.rolledBack:
      return { summary: ROLLED_BACK_NOTE, failure: true };
    case STATUS.notApplied:
      return { summary: "Изменения на устройство не вносились.", failure: true };
    case STATUS.needsAttention:
      return { summary: ATTENTION_NOTE, attention: true };
    case STATUS.rejected: {
      const step = decided(change).find((s) => s.decision === "reject");
      const who = step ? nameOf(step.user, ctx) : "";
      const why = quoted(step?.comment);
      return { summary: ["Отклонил", who].filter(Boolean).join(" ") + (why ? `: ${why}` : "") };
    }
    case STATUS.expired:
      return { summary: "Никто не решил за 24 часа." };
    case STATUS.cancelled:
      return { summary: "Заявитель отозвал запрос." };
    default:
      return { summary: "" };
  }
}

const RESULT_TITLES = {
  [STATUS.applied]: "применён",
  [STATUS.rolledBack]: "откачен",
  [STATUS.notApplied]: "не применён",
  [STATUS.rejected]: "отклонён",
  [STATUS.expired]: "истёк",
  [STATUS.cancelled]: "отозван",
  [STATUS.needsAttention]: "требует проверки",
};
const resultTitle = (change) => `Запрос на изменение конфигурации ${RESULT_TITLES[change.status] || ""}`.trim();

function resultMessage(change, ctx) {
  const facts = resultFacts(change, ctx);
  const lines = [resultTitle(change), head(ctx), titleOf(change), "", facts.summary];
  if (facts.attention && oneLine(change.failure, 300)) lines.push(`Что известно: ${oneLine(change.failure, 300)}`);
  if (facts.failure) {
    // failure пишет сам HD (воркер); текст команды — ответ роутера только при его отказе
    const failed = change.commands.find((c) => c.result?.state === "failed" && c.result.error);
    const said = failed && (failed.result.refused === true ? routerSays(failed.result.error) : notConfirmed(failed.result.error));
    // Причина подписана: без подписи её начало могло бы выглядеть как служебная строка («Утвердил: …»)
    const why = oneLine(change.failure, 300);
    for (const reason of [why && `Причина: ${why}`, said]) {
      if (reason && !lines.includes(reason)) lines.push(reason);
    }
  }
  if ([STATUS.applied, STATUS.rolledBack, STATUS.notApplied, STATUS.needsAttention].includes(change.status)) {
    for (const s of decided(change).filter((x) => x.decision === "approve" && x.decidedAt)) {
      lines.push(`Утвердил: ${nameOf(s.user, ctx)}, ${clock(s.decidedAt, ctx)}`);
    }
  }
  if (ctx.backupAt) lines.push(`Резервная копия снята в ${clock(ctx.backupAt, ctx)}.`);
  const keys = change.status === STATUS.applied && change.wireguard?.keysExpireAt;
  if (keys) lines.push("", `Конфигурация для сотрудника готова, скачать можно до ${dayMonth(keys, ctx)}, ${clock(keys, ctx)}.`);
  return clamp(lines.join("\n"));
}

// Текст записи в колокольчике (мокап: «Устройство, Компания. Название. …»).
const bellStep = (change, ctx) => {
  const first = (change.steps || [])[0];
  const second = currentStep(change)?.role === "responsible" && first?.decision === "approve";
  const who = oneLine(ctx.requesterName, 80);
  return [head(ctx), titleOf(change), second ? `${who} подтвердил, очередь за вами` : `Просит ${who}`]
    .filter(Boolean).join(". ");
};
const bellResult = (change, ctx) => {
  const facts = resultFacts(change, ctx);
  if (change.status === STATUS.applied) {
    return `${facts.summary}${change.wireguard?.keysExpireAt ? " Конфигурация для сотрудника готова" : ""}`;
  }
  if (change.status === STATUS.rejected) return `${head(ctx)}. ${facts.summary}`;
  return [head(ctx), facts.summary].filter(Boolean).join(". ");
};

// --- рассылка

function createChangeNotifier({ loadUsers, loadContext, loadPrefs, saveNotifications, pushInApp, baseUrl, log }) {
  const warn = (message, error) => {
    try { log?.log?.("warn", `Mikrotik change notification: ${message}`, { error: error?.message }); } catch { /* журнал не критичен */ }
  };

  // Уникальные адресаты события в порядке перечисления.
  const unique = (ids) => [...new Set(ids.map(idOf).filter(Boolean))];

  async function fanOut(change, { ids, kind, title, mailTitle, telegram, bell, mail }) {
    const users = ((await loadUsers(unique(ids))) || []).filter(usable);
    const prefs = loadPrefs ? await loadPrefs() : null;
    const tgOn = prefs?.notify?.byTelegram?.isActive && prefs?.notify?.personal?.[CATEGORY];
    const mailOn = prefs?.notify?.byEmail?.isActive && prefs?.notify?.personal?.[CATEGORY];
    const docs = [];
    for (const user of users) {
      const who = personName(user);
      if (tgOn && user.telegramBot?.isActive && user.telegramBot.chatId && user.notify?.byTelegram?.[CATEGORY] !== false) {
        docs.push({ instrument: "telegram", to: { chatId: user.telegramBot.chatId, applicant: who }, title, text: escapeHtml(telegram.text), replyMarkup: telegram.replyMarkup });
      }
      if (mailOn && user.email && user.notify?.byEmail?.[CATEGORY] !== false) {
        docs.push({ instrument: "email", to: { email: user.email, applicant: who }, title: mailTitle, text: mail });
      }
    }
    // Каналы независимы: сбой одного не отменяет другой. В журнал — только сообщение ошибки.
    // Колокольчик — всегда (force): выключатели категории его не гасят
    try {
      await pushInApp({ recipients: users, category: CATEGORY, kind, title, text: bell, link: pathOf(change), prefs, force: true });
    } catch (error) { warn(`bell #${change.number}`, error); }
    if (docs.length) {
      try { await saveNotifications(docs); } catch (error) { warn(`queue #${change.number}`, error); return 0; }
    }
    return docs.length;
  }

  // Имена попадают и в тему письма: перевод строки там — подмена заголовков.
  const cleanCtx = (ctx) => ({
    ...ctx,
    deviceName: oneLine(ctx.deviceName, 80),
    companyName: oneLine(ctx.companyName, 80),
    requesterName: oneLine(ctx.requesterName, 80),
    agentName: oneLine(ctx.agentName, 60),
  });

  // Письмо уходит как HTML (mail/outbox отдаёт text в html-аргумент отправщика): чужой текст экранируется,
  // переводы строк — <br>. Ссылка собирается только из baseUrl и фиксированного пути, не из текста.
  const withLink = (text, change) => {
    const body = escapeHtml(text).replace(/\n/g, "<br>");
    const url = mailUrl(baseUrl, change);
    return url ? `${body}<br><br><a href="${escapeHtml(url).replace(/"/g, "&quot;")}">Открыть в HD</a>` : body;
  };

  async function stepEvent(change, { prefix, bellTitle } = {}) {
    const step = currentStep(change);
    if (!step) return 0;
    const ctx = { ...cleanCtx(await loadContext(change)), prefix };
    const { text, fits } = stepMessage(change, ctx);
    return fanOut(change, {
      ids: [step.user],
      kind: "mikrotikChangeStep",
      title: bellTitle || `Запрос на изменение конфигурации ждёт вашего решения`,
      mailTitle: `Запрос на изменение конфигурации: ${ctx.deviceName}`,
      telegram: { text, replyMarkup: stepKeyboard(change, fits, { baseUrl }) },
      bell: bellStep(change, ctx),
      mail: withLink(text, change),
    });
  }

  async function finalEvent(change, ids) {
    const ctx = cleanCtx(await loadContext(change));
    const text = resultMessage(change, ctx);
    return fanOut(change, {
      ids,
      kind: "mikrotikChangeResult",
      title: resultTitle(change),
      mailTitle: `${resultTitle(change)}: ${ctx.deviceName}`,
      telegram: { text, replyMarkup: linkKeyboard(change, baseUrl) },
      bell: bellResult(change, ctx),
      mail: withLink(text, change),
    });
  }

  const safe = (fn) => async (change) => {
    try { return await fn(change); } catch (error) { warn(`${change?.number}`, error); return 0; }
  };

  return {
    step: safe((change) => stepEvent(change)),
    reminder: safe((change) =>
      stepEvent(change, { prefix: "Запрос истекает через 2 часа", bellTitle: `Запрос на изменение конфигурации истекает через 2 часа` })),
    decided: safe((change) => finalEvent(change, [change.requestedBy, ...decided(change).map((s) => s.user)])),
    result: safe((change) => finalEvent(change, [change.requestedBy, ...decided(change).map((s) => s.user)])),
    // Отзыв: сообщить тому, чей шаг ждал (сам заявитель отозвал — ему не пишем)
    cancelled: safe((change) => {
      const waiting = (change.steps || []).find((s) => !s.decision);
      if (!waiting || idOf(waiting.user) === idOf(change.requestedBy)) return 0;
      return finalEvent(change, [waiting.user]);
    }),
    expired: safe((change) => {
      const waiting = (change.steps || []).find((s) => !s.decision);
      return finalEvent(change, [change.requestedBy, waiting?.user]);
    }),
  };
}

// Контекст сообщения (названия, имена, пояс). Модели подгружаются лениво через `lazy`.
async function mongoLoadContext(change, lazy) {
  const User = lazy("U", "@/models/user");
  const record = await lazy("M", "@/models/mikrotik").findById(change.mikrotik)
    .select("name label companyId clientDevice").lean();
  let companyId = record?.companyId;
  if (!companyId && record?.clientDevice) {
    const device = await lazy("D", "@/models/inventory/clientDevice").findById(record.clientDevice).select("companyId").lean();
    companyId = device?.companyId;
  }
  const company = companyId ? await lazy("C", "@/models/company").findById(companyId).select("alias").lean() : null;
  const ids = [change.requestedBy, ...(change.steps || []).map((s) => s.user)].filter(Boolean);
  const users = new Map((await User.find({ _id: { $in: ids } }).select("firstName lastName").lean()).map((u) => [String(u._id), u]));
  const prefs = await lazy("P", "@/models/preferences").findOne({}).select("timezone").lean();
  let backupAt = null;
  if (change.backupArtifact) {
    const artifact = await lazy("A", "@/models/mikrotikArtifact").findById(change.backupArtifact).select("createdAt").lean();
    backupAt = artifact?.createdAt || null;
  }
  return {
    deviceName: record?.name || record?.label || "",
    companyName: company?.alias || "",
    requesterName: personName(users.get(String(change.requestedBy))),
    agentName: change.requestedVia?.keyName || "",
    timezone: prefs?.timezone || DEFAULT_TZ,
    backupAt,
    users,
    now: new Date(),
  };
}

// Боевая сборка: единственное место с моделями. Не покрыта тестами (нужна база).
const makeLazy = () => {
  const loaded = {};
  return (name, path) => (loaded[name] ||= require(path));
};

function mongoNotifier({ baseUrl, log } = {}) {
  const lazy = makeLazy();
  return createChangeNotifier({
    baseUrl,
    log,
    pushInApp: (args) => require("@/services/inAppNotifications").pushInApp(args),
    saveNotifications: (docs) => lazy("N", "@/models/notification").insertMany(docs),
    loadPrefs: () => lazy("P", "@/models/preferences").findOne({}).lean(),
    loadUsers: (ids) =>
      lazy("U", "@/models/user").find({ _id: { $in: ids } })
        .select("firstName lastName email telegramBot notify isServiceAccount banned").lean(),
    loadContext: (change) => mongoLoadContext(change, lazy),
  });
}

module.exports = {
  ROLLBACK_NOTE,
  NO_ROLLBACK_NOTE,
  ROLLED_BACK_NOTE,
  stepMessage,
  stepKeyboard,
  confirmText,
  confirmFull,
  confirmKeyboard,
  mongoLoadContext: (change) => mongoLoadContext(change, makeLazy()),
  resultMessage,
  createChangeNotifier,
  mongoNotifier,
};
