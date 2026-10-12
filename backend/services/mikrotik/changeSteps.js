// Шаги утверждения запроса на изменение Mikrotik и машина статусов.
// Чистые функции: без моделей, логгера и ввода-вывода. Id сравниваем через String().

const STATUS = {
  awaitingRequester: "awaiting_requester",
  awaitingResponsible: "awaiting_responsible",
  queued: "queued",
  applying: "applying",
  applied: "applied",
  rolledBack: "rolled_back",
  notApplied: "not_applied",
  rejected: "rejected",
  expired: "expired",
  cancelled: "cancelled",
  needsAttention: "needs_attention",
};

const STATUS_LABELS = {
  [STATUS.awaitingRequester]: "Ждёт заявителя",
  [STATUS.awaitingResponsible]: "Ждёт утверждения",
  [STATUS.queued]: "Применяется",
  [STATUS.applying]: "Применяется",
  [STATUS.applied]: "Применён",
  [STATUS.rolledBack]: "Откачен",
  [STATUS.notApplied]: "Не применён",
  [STATUS.rejected]: "Отклонён",
  [STATUS.expired]: "Истёк",
  [STATUS.cancelled]: "Отозван",
  [STATUS.needsAttention]: "Требует проверки",
};

const OPEN = new Set([STATUS.awaitingRequester, STATUS.awaitingResponsible]);
const FINAL = new Set([
  STATUS.applied,
  STATUS.rolledBack,
  STATUS.notApplied,
  STATUS.rejected,
  STATUS.expired,
  STATUS.cancelled,
  STATUS.needsAttention,
]);

const isOpen = (status) => OPEN.has(status);
const isFinal = (status) => FINAL.has(status);

const same = (a, b) => a != null && b != null && String(a) === String(b);

// Шаг «любой сотрудник с правом»: у устройства нет ответственного, человека на шаге нет до решения.
const isPoolStep = (step) => Boolean(step) && step.role === "approver";

// Кто решает — по таблице спеки «Роли и права».
// approversExist — есть ли вообще сотрудники с правом (по умолчанию считаем, что есть).
function planSteps({ requesterId, responsibleId, requesterCanApprove, responsibleCanApprove, approversExist = true }) {
  if (requesterId == null) return { ok: false, reason: "The request names no requester." };
  if (responsibleId == null) {
    if (requesterCanApprove) return { ok: true, steps: [{ role: "requester", user: requesterId }] };
    if (!approversExist) {
      return {
        ok: false,
        reason:
          "The device has no responsible person and no employee holds the mikrotik.approveChanges right, so nobody can approve this request. Ask an administrator to grant the right or to assign a responsible person for the device.",
      };
    }
    // Заявитель подтверждает, что просил; утверждает любой сотрудник с правом — кто первый
    return {
      ok: true,
      steps: [
        { role: "requester", user: requesterId },
        { role: "approver", user: null },
      ],
    };
  }
  if (!responsibleCanApprove) {
    return {
      ok: false,
      reason:
        "The responsible person for this device no longer has the mikrotik.approveChanges right, so the request cannot be approved. Ask an administrator to assign another responsible person.",
    };
  }
  if (same(requesterId, responsibleId)) {
    return { ok: true, steps: [{ role: "responsible", user: responsibleId }] };
  }
  return {
    ok: true,
    steps: [
      { role: "requester", user: requesterId },
      { role: "responsible", user: responsibleId },
    ],
  };
}

// Индекс шага, который ждёт решения (null — запрос закрыт или шагов не осталось).
function currentIndex(change) {
  if (!isOpen(change.status)) return null;
  const i = (change.steps || []).findIndex((s) => !s.decision);
  return i === -1 ? null : i;
}

function currentStep(change) {
  const i = currentIndex(change);
  if (i === null) return null;
  const { role, user } = change.steps[i];
  return { role, user: user ?? null };
}

function decide(change, { userId, decision, channel, comment, canApprove, now }) {
  if (decision !== "approve" && decision !== "reject") {
    throw new TypeError(`Unknown decision: ${String(decision)}`);
  }
  const index = currentIndex(change);
  if (index === null) return { ok: false, code: "closed" };
  // Срок без даты или с битой датой — истёкший: молча бессрочным запрос не становится
  const expiresAt = change.expiresAt ? new Date(change.expiresAt).getTime() : NaN;
  if (!(now.getTime() < expiresAt)) return { ok: false, code: "expired" };
  const step = change.steps[index];
  // Общий шаг решает любой сотрудник с правом; без права человек к запросу не причастен
  const pool = isPoolStep(step) && step.user == null;
  if (pool ? !canApprove : !same(step.user, userId)) return { ok: false, code: "not_yours" };

  // Право нужно на шаге ответственного и на шаге, после которого запрос уходит в очередь.
  const needsRight = step.role !== "requester" || index === change.steps.length - 1;
  if (decision === "approve" && needsRight && !canApprove) {
    return { ok: false, code: "no_right" };
  }

  let status;
  if (decision === "reject") status = STATUS.rejected;
  else {
    const next = change.steps[index + 1];
    if (!next) status = STATUS.queued;
    else status = next.role === "requester" ? STATUS.awaitingRequester : STATUS.awaitingResponsible;
  }
  const decided = { index, decision, channel, decidedAt: now };
  // Общий шаг получает человека в момент решения
  if (pool) decided.user = userId;
  if (comment !== undefined) decided.comment = comment;
  return { ok: true, patch: { status, step: decided } };
}

module.exports = { STATUS, STATUS_LABELS, planSteps, currentStep, decide, isOpen, isFinal, isPoolStep };
