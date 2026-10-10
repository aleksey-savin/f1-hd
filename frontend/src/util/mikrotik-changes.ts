import type {
  ChangeCommand,
  ChangeStatus,
  ChangeStep,
  ChangeView,
} from "@/types/mikrotikChange";

import { daysAgo, timeOf } from "./conversation-format.js";
import { plural } from "./plural.js";

// Запросы ИИ-агентов на изменение Mikrotik (страница запроса, раздел
// «Изменения» на странице устройства): тоны статусов, срок, подписи шагов,
// строки результата команд, тексты диалогов. Чистые функции — проверяются
// node --test. Пояс показа приходит параметром (`timeZone`): util/format-date
// читает его из localStorage и в тестах не грузится; компоненты берут пояс из
// `displayTimeZone()`. Названия статусов сервер присылает сам (`statusLabel`).

export type Tone = "wait" | "info" | "ok" | "bad" | "attention" | "idle";

type TimeOptions = { now?: Date; timeZone?: string };

const TONE_BY_STATUS: Record<ChangeStatus, Tone> = {
  awaiting_requester: "wait",
  awaiting_responsible: "wait",
  queued: "info",
  applying: "info",
  applied: "ok",
  rolled_back: "bad",
  rejected: "bad",
  not_applied: "bad",
  needs_attention: "attention",
  expired: "idle",
  cancelled: "idle",
};

export const statusTone = (status: string): Tone =>
  TONE_BY_STATUS[status as ChangeStatus] ?? "idle";

// Тон для app/device-status → DeviceStatusText (цветной текст с точкой, не
// заливной бейдж): у каталога устройств свои имена тонов.
export const STATUS_TEXT_TONE: Record<
  Tone,
  "ok" | "warn" | "info" | "bad" | "off"
> = {
  wait: "warn",
  info: "info",
  ok: "ok",
  bad: "bad",
  attention: "warn",
  idle: "off",
};

export const actionLabel = (action?: "confirm" | "approve" | null): string =>
  action === "confirm"
    ? "Подтвердить"
    : action === "approve"
      ? "Утвердить"
      : "";

/* ── Время ── */

const HOUR = 3_600_000;
const MINUTE = 60_000;
// Ближе этого срока считаем часами и минутами, дальше называем день и время
const COUNTDOWN_LIMIT = 6 * HOUR;

const dayMonth = (value: string | Date, timeZone?: string) =>
  new Date(value).toLocaleDateString("ru", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  });

/** «до завтра, 12:38» / «осталось 3 ч» / «осталось 25 мин» / «срок вышел». */
export const expiryLabel = (
  expiresAt: string | undefined,
  { now = new Date(), timeZone }: TimeOptions = {},
): string => {
  if (!expiresAt) return "";
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0) return "срок вышел";
  if (left < HOUR)
    return `осталось ${Math.max(1, Math.ceil(left / MINUTE))} мин`;
  if (left < COUNTDOWN_LIMIT) return `осталось ${Math.round(left / HOUR)} ч`;
  const time = timeOf(expiresAt, timeZone);
  const days = -daysAgo(expiresAt, now, timeZone);
  if (days <= 0) return `до ${time}`;
  if (days === 1) return `до завтра, ${time}`;
  return `до ${dayMonth(expiresAt, timeZone)}, ${time}`;
};

/** Фраза шапки: «истекает завтра в 12:38». */
export const expiresPhrase = (
  expiresAt: string | undefined,
  { now = new Date(), timeZone }: TimeOptions = {},
): string => {
  if (!expiresAt) return "";
  if (new Date(expiresAt).getTime() <= now.getTime()) return "срок вышел";
  const time = timeOf(expiresAt, timeZone);
  const days = -daysAgo(expiresAt, now, timeZone);
  if (days <= 0) return `истекает сегодня в ${time}`;
  if (days === 1) return `истекает завтра в ${time}`;
  return `истекает ${dayMonth(expiresAt, timeZone)} в ${time}`;
};

/** Строка списка: «сегодня 12:38», «вчера», «8 октября». */
export const listWhen = (
  value: string,
  { now = new Date(), timeZone }: TimeOptions = {},
): string => {
  const days = daysAgo(value, now, timeZone);
  if (days <= 0) return `сегодня ${timeOf(value, timeZone)}`;
  if (days === 1) return "вчера";
  return new Date(value).toLocaleDateString("ru", {
    timeZone,
    day: "numeric",
    month: "long",
  });
};

/** Фраза шапки о завершении: «сегодня в 12:52», «вчера в 12:52», «8 октября в 12:52». */
export const atPhrase = (
  value: string,
  { now = new Date(), timeZone }: TimeOptions = {},
): string => {
  const days = daysAgo(value, now, timeZone);
  const time = timeOf(value, timeZone);
  if (days <= 0) return `сегодня в ${time}`;
  if (days === 1) return `вчера в ${time}`;
  return `${new Date(value).toLocaleDateString("ru", { timeZone, day: "numeric", month: "long" })} в ${time}`;
};

/** Метка хроники и шага: «12:41» сегодня, иначе «09.10, 12:41». */
export const stampLabel = (
  value: string,
  { now = new Date(), timeZone }: TimeOptions = {},
): string =>
  daysAgo(value, now, timeZone) <= 0
    ? timeOf(value, timeZone)
    : `${dayMonth(value, timeZone)}, ${timeOf(value, timeZone)}`;

/* ── Команды ── */

/** «1 команда», «3 команды», «5 команд». */
export const commandsCount = (n: number): string =>
  `${n} ${plural(n, "команда", "команды", "команд")}`;

/** Винительный падеж для «Применить …»: «1 команду», «3 команды». */
export const commandsAccusative = (n: number): string =>
  `${n} ${plural(n, "команду", "команды", "команд")}`;

export const RISK_HEADLINE = "Может оборвать связь с устройством";

/** «Команда 1 меняет правило цепочки input.» */
export const riskSentence = (risky: {
  number: number;
  reason: string;
}): string => `Команда ${risky.number} ${risky.reason}.`;

// Обещание отката зависит от режима исполнителя на сервере (`rollback` в виде
// запроса): в режиме api safe mode нет и роутер ничего не откатывает. Признака
// нет (старый сервер) — считаем, что откат есть.
const ROLLBACK_PROMISE =
  "Если команда не пройдёт или связь пропадёт, роутер откатит изменения сам.";
const NO_ROLLBACK =
  "Автоматического отката нет: если команда не пройдёт, уже применённое останется.";

export const applyDialog = ({
  count,
  device,
  company,
  risky,
  rollback,
}: {
  count: number;
  device: string;
  company?: string;
  /** Первая рискованная команда запроса с высоким риском: метка стоит перед обычным текстом */
  risky?: { number: number; reason: string } | null;
  /** Есть ли автоматический откат (ChangeView.rollback) */
  rollback?: boolean;
}): { title: string; body: string } => ({
  title: `Применить ${commandsAccusative(count)} на ${device}?`,
  body: `${risky ? `${RISK_HEADLINE}. ${riskSentence(risky)} ` : ""}HD снимет резервную копию и выполнит команды на роутере${company ? ` компании ${company}` : ""}. ${rollback === false ? NO_ROLLBACK : ROLLBACK_PROMISE}`,
});

/** Подсказка под кнопками утверждения. */
export const approveHint = (rollback?: boolean): string =>
  rollback === false
    ? "Перед применением HD снимет резервную копию. Автоматического отката нет."
    : "Перед применением HD снимет резервную копию. При сбое роутер откатит изменения сам.";

// Причины риска сервер пишет по-английски (их читает ИИ-агент); человеку —
// по-русски. Список повторяет backend/services/mikrotik/changeRules.js.
const RISK_REASON: Record<string, string> = {
  "changes IP addresses": "меняет IP-адреса",
  "changes routes": "меняет маршруты",
  "changes input firewall rules": "меняет правило цепочки input",
  "changes IPv6 addresses": "меняет IPv6-адреса",
  "changes IPv6 routes": "меняет IPv6-маршруты",
  "changes NAT": "меняет NAT",
  "changes or disables interfaces": "меняет или отключает интерфейсы",
  "changes bridges": "меняет мосты",
  "changes VLANs": "меняет VLAN",
  "changes routing": "меняет маршрутизацию",
  "changes DHCP client": "меняет DHCP-клиент",
  "changes interface lists": "меняет списки интерфейсов",
};
const RISK_FALLBACK = "затрагивает настройки связи с устройством";
const RISK_SUFFIX = ": may cut off the device";

export const riskReasonText = (
  command: Pick<ChangeCommand, "riskReason">,
): string => {
  const raw = (command.riskReason ?? "").replace(RISK_SUFFIX, "");
  return RISK_REASON[raw] ?? RISK_FALLBACK;
};

/** Первая рискованная команда: её номер (с единицы) и причина. */
export const firstRisky = (
  commands: Pick<ChangeCommand, "risk" | "riskReason">[] | undefined,
): { number: number; reason: string } | null => {
  const index = (commands ?? []).findIndex((c) => c.risk === "high");
  if (index === -1 || !commands) return null;
  return { number: index + 1, reason: riskReasonText(commands[index]) };
};

// Строка результата есть у запроса, который дошёл до роутера
const EXECUTED: ChangeStatus[] = [
  "applied",
  "rolled_back",
  "not_applied",
  "needs_attention",
];

export type ResultLine = {
  tone: "ok" | "bad" | "idle";
  text: string;
  /** Ответ роутера дословно — набирается моноширинным */
  code?: string;
};

export const resultLine = (
  command: Pick<ChangeCommand, "result">,
  status: string,
): ResultLine | null => {
  if (!EXECUTED.includes(status as ChangeStatus)) return null;
  const result = command.result;
  if (!result) return null;
  switch (result.state) {
    case "done":
      return { tone: "ok", text: "Выполнена" };
    case "rolled_back":
      return { tone: "idle", text: "Выполнена, затем откачена роутером" };
    case "skipped":
      return { tone: "idle", text: "Не выполнялась" };
    case "failed":
      if (!result.error) return { tone: "bad", text: "Не выполнилась" };
      // Ответом роутера текст называется только при его отказе; иначе это слова
      // HD (таймаут, «не подтверждена», «не найдена при проверке»)
      return result.refused === true
        ? { tone: "bad", text: "Ответ роутера:", code: result.error }
        : { tone: "bad", text: `Не подтверждена: ${result.error}` };
    default:
      return status === "needs_attention"
        ? { tone: "idle", text: "Результат не подтверждён" }
        : null;
  }
};

/* ── Шаги утверждения ── */

export type StepState = "done" | "rejected" | "current" | "pending";

const OPEN: ChangeStatus[] = ["awaiting_requester", "awaiting_responsible"];

export const stepState = (
  steps: Pick<ChangeStep, "decision">[],
  index: number,
  status: string,
): StepState => {
  const step = steps[index];
  if (step.decision === "approve") return "done";
  if (step.decision === "reject") return "rejected";
  if (!OPEN.includes(status as ChangeStatus)) return "pending";
  return steps.findIndex((s) => !s.decision) === index ? "current" : "pending";
};

const CHANNEL_PHRASE: Record<string, string> = {
  portal: "на портале",
  telegram: "в Telegram",
};

/** «Подтверждено в Telegram, 12:41» — без рода: слово стоит при действии. */
export const decisionNote = (
  step: Pick<ChangeStep, "role" | "decision" | "channel" | "decidedAt">,
  stepCount: number,
  options: TimeOptions = {},
): string => {
  const word =
    step.decision === "reject"
      ? "Отклонено"
      : step.role === "requester" && stepCount > 1
        ? "Подтверждено"
        : "Утверждено";
  const parts = [
    `${word}${CHANNEL_PHRASE[step.channel ?? ""] ? ` ${CHANNEL_PHRASE[step.channel ?? ""]}` : ""}`,
  ];
  if (step.decidedAt) parts.push(stampLabel(step.decidedAt, options));
  return parts.join(", ");
};

/** Подпись шага, который ещё не решён. */
export const pendingNote = (
  step: Pick<ChangeStep, "role">,
  state: StepState,
  status?: string,
  stepCount: number = 2,
): string => {
  if (state === "current") {
    return step.role === "requester" && stepCount > 1
      ? "Подтверждает, что просил это изменение"
      : "Утверждает применение на устройстве";
  }
  return OPEN.includes(status as ChangeStatus)
    ? "Получит запрос после подтверждения заявителя"
    : "Решения не было";
};

export const ROLE_LABEL: Record<string, string> = {
  requester: "заявитель",
  responsible: "ответственный",
};

/* ── Список запросов устройства ── */

/** «4 запроса, 1 ждёт решения». */
export const listSummary = (changes: Pick<ChangeView, "status">[]): string => {
  if (!changes.length) return "";
  const total = `${changes.length} ${plural(changes.length, "запрос", "запроса", "запросов")}`;
  const waiting = changes.filter((c) => OPEN.includes(c.status)).length;
  return waiting
    ? `${total}, ${waiting} ${plural(waiting, "ждёт", "ждут", "ждут")} решения`
    : total;
};

/** Пояснение к истёкшему запросу: «Никто не решил за 24 часа». */
export const expiredAfter = (
  change: Pick<ChangeView, "createdAt" | "expiresAt">,
): string => {
  if (!change.expiresAt) return "Никто не решил";
  const hours = Math.max(
    1,
    Math.round(
      (new Date(change.expiresAt).getTime() -
        new Date(change.createdAt).getTime()) /
        HOUR,
    ),
  );
  return `Никто не решил за ${hours} ${plural(hours, "час", "часа", "часов")}`;
};
