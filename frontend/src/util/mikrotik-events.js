// Журнал устройства Mikrotik: как событие превращается в строку ленты.
//
// Вид (`kind`), группа и тон приходят с бэкенда — каталог видов там
// (`services/mikrotik/eventKinds.js`); здесь только то, что видит человек.
// Модуль чистый (без React и значков): значки по группам — в
// components/Mikrotik/JournalSection.jsx.
import { plural } from "./plural.js";

/** Фильтры раздела «Журнал»: значение — группа событий на бэкенде. */
export const JOURNAL_FILTERS = [
  { value: "all", label: "Все" },
  { value: "link", label: "Связь" },
  { value: "power", label: "Питание и прошивка" },
  { value: "config", label: "Конфигурация" },
  { value: "record", label: "Запись в HD" },
  { value: "agent", label: "Агенты" },
  { value: "router", label: "Лог роутера" },
];

/** Цвет несёт состояние, а не тип события: обычное событие серое. */
export const SEVERITY_TONE = { ok: "ok", warning: "warn", danger: "bad", info: "muted" };

// От скольких строк лога роутера подряд строки сворачиваются
export const RAW_FOLD_FROM = 3;

const duration = (seconds) => {
  const minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  if (minutes < 1) return "меньше минуты";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} ${plural(days, "день", "дня", "дней")}`);
  if (hours) parts.push(`${hours} ${plural(hours, "час", "часа", "часов")}`);
  if (rest && !days) parts.push(`${rest} ${plural(rest, "минуту", "минуты", "минут")}`);
  return parts.join(" ");
};

const lines = (n) => `${n} ${plural(n, "строка", "строки", "строк")}`;
const list = (values) => (values || []).filter(Boolean).join(", ");
const sentence = (parts) => parts.filter(Boolean).join(". ") || null;

const TRIGGERS = {
  manual: "вручную",
  scheduled: "по расписанию",
  "pre-upgrade": "перед обновлением",
  "pre-change": "перед изменением",
};
const CHANNELS = { portal: "на портале", telegram: "в Telegram" };
const TOOLS = { config: "конфигурация", state: "состояние", log: "лог", ping: "ping", traceroute: "traceroute" };
const FIELDS = {
  host: "Адрес",
  port: "Порт API",
  user: "Пользователь",
  sshPort: "Порт SSH",
  label: "Название",
  firmwareUpgradeEnabled: "Обновление из HD",
};
const FLAT_FIELDS = {
  transit: "Путь подключения изменён",
  company: "Компания изменена",
  password: "Пароль изменён",
  knock: "Port knocking изменён",
};
const fieldValue = (value) => (value === true ? "включено" : value === false ? "выключено" : (value ?? "—"));

const who = (event) => {
  const { actor } = event;
  if (!actor?.name) return null;
  if (actor.type === "agent" && actor.onBehalfOf) return `${actor.name}, просит ${actor.onBehalfOf}`;
  return actor.name;
};

// Запросы агента: подпись по виду; название запроса — отдельной строкой-ссылкой
const CHANGE_LABELS = {
  changeProposed: "Агент предложил изменение",
  changeRefused: "Запрос агента не принят",
  changeConfirmed: "Запрос агента подтверждён",
  changeApproved: "Запрос агента утверждён",
  changeRejected: "Запрос агента отклонён",
  changeCancelled: "Запрос агента отозван",
  changeApplied: "Запрос агента применён",
  changeRolledBack: "Запрос агента откачен роутером",
  changeNotApplied: "Запрос агента не применён",
  changeNeedsAttention: "Запрос агента требует проверки",
  changeExpired: "Запрос агента истёк",
};

const commands = (n) => (n ? `${n} ${plural(n, "команда", "команды", "команд")}` : null);

const parameterDetail = (data) => {
  const parts = (data.fields || []).map((entry) =>
    FLAT_FIELDS[entry.field]
      ? FLAT_FIELDS[entry.field]
      : `${FIELDS[entry.field] || entry.field}: ${fieldValue(entry.from)} → ${fieldValue(entry.to)}`,
  );
  if (data.responsible) {
    parts.push(`Ответственный: ${data.responsible.from || "не назначен"} → ${data.responsible.to || "не назначен"}`);
  }
  return sentence(parts);
};

const configDetail = (data) => {
  if (data.unknown) return "Состав отличий не сохранён: событие старше журнала";
  if (!data.added && !data.removed) return "Изменились только скрытые значения";
  const counts = [
    data.added ? `добавлено: ${lines(data.added)}` : null,
    data.removed ? `убрано: ${lines(data.removed)}` : null,
  ].filter(Boolean).join(", ");
  const menus = list(data.sections);
  const more = data.moreSections ? ` и ещё ${data.moreSections}` : "";
  return sentence([`Строк ${counts}`, menus ? `Меню: ${menus}${more}` : null]);
};

/**
 * Строка ленты: { label, who, detail, change, title, raw, tone }.
 *   who    — кто (после подписи, приглушённо);
 *   detail — содержание обычным текстом;
 *   change — «было → стало» моноширинно;
 *   title  — название запроса агента (ссылка на запрос по event.changeId);
 *   raw    — строки как есть, моноширинно (лог роутера, ответ роутера, отказ агенту).
 * formatTime — форматтер времени из util/format-date (передаётся, чтобы модуль остался чистым).
 */
export function eventLine(event, { formatTime = () => "" } = {}) {
  const data = event.data || {};
  const base = { label: event.kind, who: who(event), detail: null, change: null, title: null, raw: [], tone: SEVERITY_TONE[event.severity] || "muted" };
  const versions = data.from || data.to ? { from: data.from, to: data.to } : null;

  switch (event.kind) {
    case "offline":
      return { ...base, label: data.planned ? "Не в сети по расписанию" : "Не в сети", raw: data.error ? [data.error] : [] };
    case "recovered":
      return { ...base, label: "Снова в сети", detail: `Не отвечало ${duration(data.downSeconds)}` };
    case "reboot":
      return {
        ...base,
        label: "Перезагрузка",
        who: data.cause === "upgrade" ? "при обновлении из HD" : "не из HD",
        detail: data.ranSeconds ? `До этого работало ${duration(data.ranSeconds)}` : null,
      };
    case "firmwareChanged":
      return { ...base, label: "Версия RouterOS изменилась", who: data.cause === "upgrade" ? null : "не из HD", change: versions };
    case "identityChanged":
      return { ...base, label: "Имя устройства изменилось", change: versions };
    case "serialChanged":
      return { ...base, label: "Серийный номер изменился", change: versions };
    case "upgradeStarted":
      return { ...base, label: "Обновление запущено", detail: list([data.channel ? `Ветка ${data.channel}` : null, data.to ? `до ${data.to}` : null]) || null };
    case "upgradeFinished":
      return { ...base, label: "Обновление завершено", change: versions };
    case "upgradeFailed":
      return { ...base, label: "Обновление не удалось", change: versions, raw: data.error ? [data.error] : [] };
    case "upgradeCancelled":
      return { ...base, label: "Обновление остановлено", detail: data.state === "running" ? "Устройство уже обновлялось: текущий шаг доводится до конца" : "До устройства очередь не дошла" };
    case "configChanged":
      return { ...base, label: "Конфигурация изменилась", detail: configDetail(data) };
    case "exportCreated":
      return { ...base, label: "Копия конфигурации", who: list([TRIGGERS[data.trigger] || data.trigger, base.who]) || null };
    case "exportDeleted":
      return { ...base, label: "Копия конфигурации удалена", raw: data.fileName ? [data.fileName] : [] };
    case "exportDownloaded":
      return { ...base, label: "Копия конфигурации скачана", raw: data.fileName ? [data.fileName] : [] };
    case "scheduleChanged":
      return { ...base, label: "Расписание копий изменено" };
    case "recordCreated":
      return { ...base, label: "Устройство добавлено в мониторинг" };
    case "parametersChanged":
      return { ...base, label: "Параметры изменены", detail: parameterDetail(data) };
    case "monitoringOn":
      return { ...base, label: "Мониторинг включён" };
    case "monitoringOff":
      return { ...base, label: "Мониторинг выключен" };
    case "plannedOfflineChanged": {
      const count = (data.windows || []).length;
      return { ...base, label: "Плановые отключения изменены", detail: count ? `${count} ${plural(count, "окно", "окна", "окон")}` : "Окна убраны" };
    }
    case "inventoryLinked":
      return { ...base, label: data.how === "created" ? "Создана карточка инвентаря" : "Связано с карточкой инвентаря" };
    case "pinned":
      return { ...base, label: data.what === "ssh" ? "Закреплён ключ SSH устройства" : "Закреплён сертификат устройства" };
    case "changeRefused":
      return { ...base, label: CHANGE_LABELS.changeRefused, detail: data.title || null, raw: data.reason ? [data.reason] : [] };
    case "changeProposed":
      return { ...base, label: CHANGE_LABELS.changeProposed, title: data.title || null, detail: commands(data.commands) };
    case "changeConfirmed":
    case "changeApproved":
    case "changeRejected":
      return { ...base, label: CHANGE_LABELS[event.kind], who: list([base.who, CHANNELS[data.channel]]) || null, title: data.title || null, detail: data.comment ? `«${data.comment}»` : null };
    case "changeCancelled":
    case "changeApplied":
    case "changeRolledBack":
    case "changeNotApplied":
    case "changeNeedsAttention":
    case "changeExpired":
      return { ...base, label: CHANGE_LABELS[event.kind], title: data.title || null, detail: data.failure || (event.kind === "changeApplied" ? commands(data.commands) : null) };
    case "agentAccess": {
      const what = list([...(data.tools || []).filter((tool) => tool !== "ping" && tool !== "traceroute").map((tool) => TOOLS[tool] || tool), ...(data.targets || []).map((target) => `ping ${target}`)]);
      const count = event.count > 1 ? `${event.count} ${plural(event.count, "обращение", "обращения", "обращений")} с ${formatTime(data.since)}` : null;
      return { ...base, label: "Агент обращался к роутеру", detail: [count, what].filter(Boolean).join(": ") || null };
    }
    case "routerConfig":
      return { ...base, label: "Конфигурация изменена на роутере", who: list([base.who, data.byHd ? "учётная запись HD" : null]) || null, raw: data.lines || [], rawTotal: data.count };
    case "routerLogin":
      return { ...base, label: "Вход на роутер", who: list([base.who, data.via, data.from ? `с ${data.from}` : null]) || null };
    case "routerLoginFailed":
      return { ...base, label: "Неудачные входы на роутер", detail: `${data.count} ${plural(data.count, "попытка", "попытки", "попыток")}: ${list([list(data.users), list(data.via), (data.sources || []).length ? `с ${list(data.sources)}` : null])}` };
    case "routerSystem":
      return { ...base, label: "Сообщение роутера", raw: data.message ? [data.message] : [] };
    case "routerCritical":
      return { ...base, label: "Ошибка на роутере", raw: data.message ? [data.message] : [] };
    case "routerMore":
      return { ...base, label: `Ещё ${lines(data.count)} лога не сохранено` };
    default:
      return base;
  }
}

/** События по дням: [{ key, events }], порядок сохраняется. dayKey — businessDayKey из format-date. */
export function groupByDay(events, dayKey) {
  const days = [];
  for (const event of events) {
    const key = dayKey(event.at);
    const last = days.at(-1);
    if (last?.key === key) last.events.push(event);
    else days.push({ key, at: event.at, events: [event] });
  }
  return days;
}
