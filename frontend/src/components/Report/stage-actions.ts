import type {
  Actor,
  Awaiting,
  PreviewRow,
  ReportRow,
  ReportStatus,
} from "../../types/approval";
import { plural } from "../../util/plural.js";

/**
 * Ходы нашей стороны по конвейеру «Согласования работ» — что у них спросить
 * перед выполнением.
 *
 * Каждое действие, которое двигает отчёт (сформировать, напомнить, выставить
 * счёт, подтвердить оплату, вернуть на стадию назад), проходит через диалог
 * подтверждения, и диалог один на строку списка и на карточку отчёта. Здесь его
 * слова: заголовок, строка о том, что произойдёт, и подпись кнопки. Модуль
 * чистый — даты форматирует вызывающий (пояс организации берётся с сервера).
 */

export type StageActionKind =
  | "submit"
  | "remind"
  | "invoice"
  | "payment"
  | "archive"
  | "rollback";

/** Отчёт (или строка превью) в том виде, который нужен диалогу. */
export type StageSubject = {
  /** null — строка превью: отчётом она ещё не стала. */
  id: string | null;
  status: ReportStatus | "preview";
  company: string;
  servicePlan: string;
  period: string;
  /** null — зрителю итог договора не показывается. */
  total: number | null;
  worksCount: number;
  approval: {
    required: boolean;
    bySubdivisions: boolean;
    finalApprover?: Actor | null;
  };
  awaiting?: Awaiting;
  invoice?: { number?: string; date?: string; fullyPaidAt?: string };
  lastRemindedAt?: string | null;
  /** Когда клиент подписал отчёт целиком — из истории, только на карточке. */
  customerApprovedAt?: string | null;
  /** Срок ответа, если отправить сейчас (считает сервер). */
  sendDeadlineAt?: string | null;
  /** Состав будущего отчёта — только у строки превью. */
  preview?: { companyId: string; servicePlanId: string; workIds: string[] };
};

export type StageActionCopy = {
  title: string;
  note: string;
  confirmLabel: string;
  variant: "default" | "destructive" | "warning";
};

type Formatters = { date: (value: string) => string | null };

/**
 * Предмет диалога из сохранённого отчёта — строки списка стадии или карточки:
 * карточка несёт те же поля, что и строка.
 */
export const subjectOfReport = (
  report: Pick<
    ReportRow,
    | "_id"
    | "status"
    | "company"
    | "servicePlan"
    | "period"
    | "total"
    | "worksCount"
    | "invoice"
    | "approval"
    | "awaiting"
    | "lastRemindedAt"
    | "customerApprovedAt"
  >,
): StageSubject => ({
  id: report._id,
  status: report.status,
  company: report.company?.alias || report.company?.fullTitle || "",
  servicePlan: report.servicePlan?.title || "",
  period: report.period || "",
  total: report.total,
  worksCount: report.worksCount,
  approval: {
    required: Boolean(report.approval?.required),
    bySubdivisions: Boolean(report.approval?.bySubdivisions),
    finalApprover: report.approval?.finalApprover ?? null,
  },
  awaiting: report.awaiting,
  invoice: report.invoice,
  lastRemindedAt: report.lastRemindedAt ?? null,
  customerApprovedAt: report.customerApprovedAt ?? null,
});

/**
 * Предмет диалога из строки превью. Месяц и срок ответа приходят снаружи:
 * месяц — готовой подписью, срок считает сервер на момент загрузки конвейера.
 */
export const subjectOfPreview = (
  row: Pick<
    PreviewRow,
    "company" | "servicePlan" | "approval" | "worksCount" | "workIds" | "total"
  >,
  extra: { period: string; sendDeadlineAt?: string | null },
): StageSubject => ({
  id: null,
  status: "preview",
  company: row.company.alias || row.company.fullTitle || "",
  servicePlan: row.servicePlan.title,
  period: extra.period,
  total: row.total,
  worksCount: row.worksCount,
  approval: {
    required: row.approval.required,
    bySubdivisions: row.approval.bySubdivisions,
    finalApprover: row.approval.approver,
  },
  // Срок есть только там, где есть кого ждать
  sendDeadlineAt: row.approval.required ? (extra.sendDeadlineAt ?? null) : null,
  preview: {
    companyId: row.company._id,
    servicePlanId: row.servicePlan._id,
    workIds: row.workIds,
  },
});

const STAGE_LABEL = {
  approved: "Сформировать счёт",
  awaitingPayment: "Ждём оплаты",
  paid: "Оплачен",
} as const;

/**
 * Куда вернётся отчёт. После счёта — на одну стадию (из архива — в
 * «Оплачен»); до счёта — в превью:
 * стадии «превью» у документа нет, отчёт расформировывается, а работы
 * возвращаются в подбор. Правило повторяет серверное
 * (backend/services/reportStageMoves.js) — сервер решает, клиент подписывает.
 */
export const rollbackTargetOf = (
  status: StageSubject["status"],
): "preview" | "approved" | "awaitingPayment" | "paid" | null => {
  if (status === "archived") return "paid";
  if (status === "paid") return "awaitingPayment";
  if (status === "awaitingPayment") return "approved";
  if (
    status === "approved" ||
    status === "pendingApproval" ||
    status === "declined"
  ) {
    return "preview";
  }
  return null;
};

export const rollbackMenuLabel = (status: StageSubject["status"]) => {
  const target = rollbackTargetOf(status);
  if (!target) return null;
  return target === "preview"
    ? "Вернуть в превью"
    : `Вернуть в «${STAGE_LABEL[target]}»`;
};

const personName = (person?: Actor | null) =>
  person ? `${person.lastName || ""} ${person.firstName || ""}`.trim() : "";

const invoiceLabel = (subject: StageSubject, fmt: Formatters) => {
  const number = subject.invoice?.number;
  const date = subject.invoice?.date ? fmt.date(subject.invoice.date) : null;
  return `${number ? `Счёт ${number}` : "Счёт"}${date ? ` от ${date}` : ""}`;
};

/**
 * Вторая строка сводки в диалоге: услуга, период и то, что отличает отчёт на
 * его стадии, — счёт у ждущего оплаты, подписи у ждущего согласования.
 */
export const subjectMeta = (subject: StageSubject, fmt: Formatters) => {
  const parts = [subject.servicePlan, subject.period];
  const paidAt = subject.invoice?.fullyPaidAt;

  if ((subject.status === "paid" || subject.status === "archived") && paidAt) {
    parts.push(`оплачен ${fmt.date(paidAt)}`);
  } else if (subject.status === "awaitingPayment") {
    const label = invoiceLabel(subject, fmt);
    parts.push(label.charAt(0).toLowerCase() + label.slice(1));
  } else if (
    subject.status === "pendingApproval" &&
    subject.awaiting?.kind === "subdivisions"
  ) {
    parts.push(
      `подписано ${subject.awaiting.approved} из ${subject.awaiting.total}`,
    );
  } else {
    parts.push(
      `${subject.worksCount} ${plural(subject.worksCount, "работа", "работы", "работ")}`,
    );
  }

  return parts.filter(Boolean).join(" · ");
};

const worksReturn = (count: number) =>
  `${count} ${plural(count, "работа", "работы", "работ")} ${plural(count, "вернётся", "вернутся", "вернутся")} в превью`;

const submitCopy = (
  subject: StageSubject,
  fmt: Formatters,
): StageActionCopy => {
  if (!subject.approval.required) {
    return {
      title: "Утвердить отчёт?",
      note: "Отчёт будет сформирован и перейдёт на стадию «Сформировать счёт». Работы уйдут из превью.",
      confirmLabel: "Утвердить",
      variant: "default",
    };
  }

  const approver = personName(subject.approval.finalApprover);
  const who = subject.approval.bySubdivisions
    ? `Письма со ссылкой на отчёт получат руководители подразделений${approver ? `, итог подпишет ${approver}` : ""}.`
    : `Письмо со ссылкой на отчёт получит ${approver || "согласующий со стороны клиента"}.`;
  const deadline = subject.sendDeadlineAt
    ? ` Ответить нужно до ${fmt.date(subject.sendDeadlineAt)} — без ответа отчёт будет согласован автоматически.`
    : "";

  return {
    title: "Отправить отчёт на согласование?",
    note: `${who}${deadline}`,
    confirmLabel: "Отправить на согласование",
    variant: "default",
  };
};

const remindCopy = (
  subject: StageSubject,
  fmt: Formatters,
): StageActionCopy => {
  const awaiting = subject.awaiting;
  const who =
    awaiting?.kind === "subdivisions"
      ? `Письмо уйдёт руководителям подразделений, чьей подписи отчёт ждёт сейчас${awaiting.names.length ? `: ${awaiting.names.join(", ")}` : ""}.`
      : `Письмо уйдёт тому, чьей подписи отчёт ждёт сейчас${awaiting?.name ? `: ${awaiting.name}` : ""}.`;
  const last = subject.lastRemindedAt
    ? ` Прошлое напоминание — ${fmt.date(subject.lastRemindedAt)}.`
    : "";

  return {
    title: "Напомнить о подписи?",
    note: `${who}${last}`,
    confirmLabel: "Напомнить",
    variant: "default",
  };
};

const rollbackCopy = (
  subject: StageSubject,
  fmt: Formatters,
): StageActionCopy => {
  const target = rollbackTargetOf(subject.status);

  if (target === "paid") {
    return {
      title: "Вернуть отчёт в «Оплачен»?",
      note: "Отчёт вернётся из архива в конвейер, на стадию «Оплачен». Счёт и отметка об оплате сохранятся.",
      confirmLabel: "Вернуть",
      // Возврат из архива ничего не снимает — предупреждать не о чем
      variant: "default",
    };
  }

  if (target === "awaitingPayment") {
    const paidAt = subject.invoice?.fullyPaidAt;
    return {
      title: "Вернуть отчёт в «Ждём оплаты»?",
      note: `Отметка об оплате${paidAt ? ` от ${fmt.date(paidAt)}` : ""} будет снята. ${invoiceLabel(subject, fmt)} останется на отчёте.`,
      confirmLabel: "Вернуть",
      variant: "warning",
    };
  }

  if (target === "approved") {
    return {
      title: "Вернуть отчёт в «Сформировать счёт»?",
      note: `${invoiceLabel(subject, fmt)} будет снят с отчёта. ${
        subject.approval.required
          ? "Состав работ и согласование клиента сохранятся."
          : "Состав работ сохранится."
      }`,
      confirmLabel: "Вернуть",
      variant: "warning",
    };
  }

  // Расформирование: чем дальше отчёт успел уйти, тем больше теряется
  const lines = [
    `Отчёт будет расформирован, ${worksReturn(subject.worksCount)}.`,
  ];

  if (subject.status === "pendingApproval") {
    const signed =
      subject.awaiting?.kind === "subdivisions" &&
      subject.awaiting.approved > 0;
    lines.push(
      signed
        ? "Уже поставленные подписи пропадут, ссылки из писем перестанут открываться."
        : "Ссылки из писем перестанут открываться.",
      "Согласующие получат уведомление об отзыве отчёта.",
    );
  } else if (subject.status === "approved" && subject.approval.required) {
    const at = subject.customerApprovedAt
      ? ` от ${fmt.date(subject.customerApprovedAt)}`
      : "";
    lines.push(
      `Согласование клиента${at} пропадёт — новый отчёт придётся согласовать заново.`,
    );
  }

  return {
    title: "Вернуть отчёт в превью?",
    note: lines.join(" "),
    confirmLabel: "Вернуть в превью",
    variant: "destructive",
  };
};

export const stageActionCopy = (
  kind: StageActionKind,
  subject: StageSubject,
  fmt: Formatters,
): StageActionCopy => {
  switch (kind) {
    case "submit":
      return submitCopy(subject, fmt);
    case "remind":
      return remindCopy(subject, fmt);
    case "invoice":
      return {
        title: "Выставить счёт",
        note: "Отчёт перейдёт на стадию «Ждём оплаты».",
        confirmLabel: "Выставить счёт",
        variant: "default",
      };
    case "payment":
      return {
        title: "Подтвердить оплату",
        note: "Отчёт перейдёт на стадию «Оплачен».",
        confirmLabel: "Подтвердить оплату",
        variant: "default",
      };
    case "archive":
      return {
        title: "Отправить отчёт в архив?",
        note: "Отчёт уйдёт из конвейера: в списках стадий его больше не будет. Вернуть его можно из этой карточки.",
        confirmLabel: "В архив",
        variant: "default",
      };
    case "rollback":
      return rollbackCopy(subject, fmt);
  }
};
