// Жизненный цикл предложения ИИ-агента по инвентарю: статусы и решение заявителя.
// Чистые функции: без моделей, логгера и ввода-вывода. Id сравниваем через String().

const STATUS = {
  awaitingRequester: "awaiting_requester",
  applying: "applying",
  done: "done",
  partial: "partial",
  failed: "failed",
  rejected: "rejected",
  expired: "expired",
};

const STATUS_LABELS = {
  [STATUS.awaitingRequester]: "Ждёт утверждения",
  [STATUS.applying]: "Применяется",
  [STATUS.done]: "Применено",
  [STATUS.partial]: "Применено частично",
  [STATUS.failed]: "Не применено",
  [STATUS.rejected]: "Отклонено",
  [STATUS.expired]: "Истекло",
};

// Срок жизни предложения; застрявшее в applying дольше STUCK_MS уходит в failed (sweep)
const TTL_MS = 3 * 24 * 3600 * 1000;
const STUCK_MS = 10 * 60 * 1000;

const isOpen = (status) => status === STATUS.awaitingRequester;
const isFinal = (status) =>
  [STATUS.done, STATUS.partial, STATUS.failed, STATUS.rejected, STATUS.expired].includes(status);

const same = (a, b) => a != null && b != null && String(a) === String(b);

// Решает только заявитель. Порядок отказов: истёк (статус expired — до «закрыт»: решения не было,
// и «Решение уже принято» было бы неправдой), закрыт, истёк по сроку, не его.
function decide(change, { userId, decision, channel, comment, now }) {
  if (decision !== "approve" && decision !== "reject") {
    throw new TypeError(`Unknown decision: ${String(decision)}`);
  }
  if (change.status === STATUS.expired) return { ok: false, code: "expired" };
  if (!isOpen(change.status)) return { ok: false, code: "closed" };
  // Срок без даты или с битой датой — истёкший: молча бессрочным предложение не становится
  const expiresAt = change.expiresAt ? new Date(change.expiresAt).getTime() : NaN;
  if (!(now.getTime() < expiresAt)) return { ok: false, code: "expired" };
  if (!same(change.requestedBy, userId)) return { ok: false, code: "not_yours" };

  const status = decision === "approve" ? STATUS.applying : STATUS.rejected;
  const record = { user: userId, decision, at: now };
  if (channel !== undefined) record.channel = channel;
  if (comment !== undefined) record.comment = comment;
  return { ok: true, patch: { status, decision: record } };
}

module.exports = { STATUS, STATUS_LABELS, TTL_MS, STUCK_MS, decide, isOpen, isFinal };
