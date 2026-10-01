// node --test src/components/Report/stage-actions.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rollbackMenuLabel,
  rollbackTargetOf,
  stageActionCopy,
  subjectMeta,
  subjectOfPreview,
  subjectOfReport,
} from "./stage-actions.ts";

// Форматтер дат подставной: настоящий читает пояс из localStorage
const fmt = { date: (value) => `<${String(value).slice(0, 10)}>` };

const base = {
  id: "r1",
  status: "approved",
  company: "Альфа-Строй",
  servicePlan: "Абонентское обслуживание",
  period: "август 2026",
  total: 135631.25,
  worksCount: 5,
  approval: { required: true, bySubdivisions: false },
};

test("после счёта возврат — на одну стадию, до счёта — в превью", () => {
  assert.equal(rollbackTargetOf("paid"), "awaitingPayment");
  assert.equal(rollbackTargetOf("awaitingPayment"), "approved");
  assert.equal(rollbackTargetOf("approved"), "preview");
  assert.equal(rollbackTargetOf("pendingApproval"), "preview");
  assert.equal(rollbackTargetOf("declined"), "preview");
});

test("из архива отчёт возвращается в «Оплачен», из превью возвращать некуда", () => {
  assert.equal(rollbackTargetOf("archived"), "paid");
  assert.equal(rollbackMenuLabel("archived"), "Вернуть в «Оплачен»");
  assert.equal(rollbackTargetOf("preview"), null);
  assert.equal(rollbackMenuLabel("preview"), null);
});

test("пункт меню называет стадию, куда вернётся отчёт", () => {
  assert.equal(rollbackMenuLabel("approved"), "Вернуть в превью");
  assert.equal(
    rollbackMenuLabel("awaitingPayment"),
    "Вернуть в «Сформировать счёт»",
  );
  assert.equal(rollbackMenuLabel("paid"), "Вернуть в «Ждём оплаты»");
});

test("строка-сводка: услуга, период и то, что важно на этой стадии", () => {
  assert.equal(
    subjectMeta(base, fmt),
    "Абонентское обслуживание · август 2026 · 5 работ",
  );
  assert.equal(
    subjectMeta(
      {
        ...base,
        status: "pendingApproval",
        awaiting: {
          kind: "subdivisions",
          approved: 2,
          pending: 2,
          total: 5,
          names: [],
        },
      },
      fmt,
    ),
    "Абонентское обслуживание · август 2026 · подписано 2 из 5",
  );
  assert.equal(
    subjectMeta(
      {
        ...base,
        status: "awaitingPayment",
        invoice: { number: "214", date: "2026-09-15T00:00:00Z" },
      },
      fmt,
    ),
    "Абонентское обслуживание · август 2026 · счёт 214 от <2026-09-15>",
  );
  assert.equal(
    subjectMeta(
      {
        ...base,
        status: "paid",
        invoice: { number: "214", fullyPaidAt: "2026-09-28T00:00:00Z" },
      },
      fmt,
    ),
    "Абонентское обслуживание · август 2026 · оплачен <2026-09-28>",
  );
});

test("превью без согласования: отчёт сразу уходит на счёт", () => {
  const copy = stageActionCopy(
    "submit",
    {
      ...base,
      status: "preview",
      approval: { required: false, bySubdivisions: false },
    },
    fmt,
  );
  assert.equal(copy.title, "Утвердить отчёт?");
  assert.equal(copy.confirmLabel, "Утвердить");
  assert.equal(
    copy.note,
    "Отчёт будет сформирован и перейдёт на стадию «Сформировать счёт». Работы уйдут из превью.",
  );
});

test("превью с согласованием: названы получатель письма и срок ответа", () => {
  const copy = stageActionCopy(
    "submit",
    {
      ...base,
      status: "preview",
      approval: {
        required: true,
        bySubdivisions: false,
        finalApprover: { _id: "u1", firstName: "Олег", lastName: "Кузнецов" },
      },
      sendDeadlineAt: "2026-10-08T13:59:59Z",
    },
    fmt,
  );
  assert.equal(copy.title, "Отправить отчёт на согласование?");
  assert.equal(copy.confirmLabel, "Отправить на согласование");
  assert.equal(
    copy.note,
    "Письмо со ссылкой на отчёт получит Кузнецов Олег. Ответить нужно до <2026-10-08> — без ответа отчёт будет согласован автоматически.",
  );
});

test("согласование по подразделениям: первыми письмо получают руководители", () => {
  const copy = stageActionCopy(
    "submit",
    {
      ...base,
      status: "preview",
      approval: {
        required: true,
        bySubdivisions: true,
        finalApprover: { _id: "u1", firstName: "Олег", lastName: "Кузнецов" },
      },
    },
    fmt,
  );
  assert.equal(
    copy.note,
    "Письма со ссылкой на отчёт получат руководители подразделений, итог подпишет Кузнецов Олег.",
  );
});

test("напоминание называет, кому уйдёт письмо и когда напоминали", () => {
  const copy = stageActionCopy(
    "remind",
    {
      ...base,
      status: "pendingApproval",
      awaiting: {
        kind: "subdivisions",
        approved: 2,
        pending: 2,
        total: 5,
        names: ["Филиал «Север»", "Филиал «Юг»"],
      },
      lastRemindedAt: "2026-09-28T05:00:00Z",
    },
    fmt,
  );
  assert.equal(copy.title, "Напомнить о подписи?");
  assert.equal(copy.confirmLabel, "Напомнить");
  assert.equal(
    copy.note,
    "Письмо уйдёт руководителям подразделений, чьей подписи отчёт ждёт сейчас: Филиал «Север», Филиал «Юг». Прошлое напоминание — <2026-09-28>.",
  );

  const single = stageActionCopy(
    "remind",
    {
      ...base,
      status: "pendingApproval",
      awaiting: { kind: "final", name: "Кузнецов Олег" },
    },
    fmt,
  );
  assert.equal(
    single.note,
    "Письмо уйдёт тому, чьей подписи отчёт ждёт сейчас: Кузнецов Олег.",
  );
});

test("счёт и оплата называют стадию, куда уйдёт отчёт", () => {
  const invoice = stageActionCopy("invoice", base, fmt);
  assert.equal(invoice.title, "Выставить счёт");
  assert.equal(invoice.confirmLabel, "Выставить счёт");
  assert.equal(invoice.note, "Отчёт перейдёт на стадию «Ждём оплаты».");

  const payment = stageActionCopy(
    "payment",
    { ...base, status: "awaitingPayment" },
    fmt,
  );
  assert.equal(payment.title, "Подтвердить оплату");
  assert.equal(payment.confirmLabel, "Подтвердить оплату");
  assert.equal(payment.note, "Отчёт перейдёт на стадию «Оплачен».");
});

test("возврат утверждённого в превью предупреждает о потере согласования", () => {
  const copy = stageActionCopy(
    "rollback",
    { ...base, customerApprovedAt: "2026-09-03T02:00:00Z" },
    fmt,
  );
  assert.equal(copy.title, "Вернуть отчёт в превью?");
  assert.equal(copy.confirmLabel, "Вернуть в превью");
  assert.equal(copy.variant, "destructive");
  assert.equal(
    copy.note,
    "Отчёт будет расформирован, 5 работ вернутся в превью. Согласование клиента от <2026-09-03> пропадёт — новый отчёт придётся согласовать заново.",
  );
});

test("услуга без согласования: терять при возврате в превью нечего", () => {
  const copy = stageActionCopy(
    "rollback",
    {
      ...base,
      worksCount: 1,
      approval: { required: false, bySubdivisions: false },
    },
    fmt,
  );
  assert.equal(
    copy.note,
    "Отчёт будет расформирован, 1 работа вернётся в превью.",
  );
});

test("отзыв с утверждения: подписи пропадут, согласующих предупредим", () => {
  const copy = stageActionCopy(
    "rollback",
    {
      ...base,
      status: "pendingApproval",
      worksCount: 6,
      awaiting: {
        kind: "subdivisions",
        approved: 2,
        pending: 2,
        total: 5,
        names: [],
      },
    },
    fmt,
  );
  assert.equal(copy.variant, "destructive");
  assert.equal(
    copy.note,
    "Отчёт будет расформирован, 6 работ вернутся в превью. Уже поставленные подписи пропадут, ссылки из писем перестанут открываться. Согласующие получат уведомление об отзыве отчёта.",
  );

  const untouched = stageActionCopy(
    "rollback",
    {
      ...base,
      status: "pendingApproval",
      worksCount: 2,
      awaiting: { kind: "final", name: "Кузнецов Олег" },
    },
    fmt,
  );
  assert.equal(
    untouched.note,
    "Отчёт будет расформирован, 2 работы вернутся в превью. Ссылки из писем перестанут открываться. Согласующие получат уведомление об отзыве отчёта.",
  );
});

test("возврат со счёта снимает только счёт", () => {
  const copy = stageActionCopy(
    "rollback",
    {
      ...base,
      status: "awaitingPayment",
      invoice: { number: "214", date: "2026-09-15T00:00:00Z" },
    },
    fmt,
  );
  assert.equal(copy.title, "Вернуть отчёт в «Сформировать счёт»?");
  assert.equal(copy.confirmLabel, "Вернуть");
  assert.equal(copy.variant, "warning");
  assert.equal(
    copy.note,
    "Счёт 214 от <2026-09-15> будет снят с отчёта. Состав работ и согласование клиента сохранятся.",
  );
});

test("возврат оплаченного снимает только отметку об оплате", () => {
  const copy = stageActionCopy(
    "rollback",
    {
      ...base,
      status: "paid",
      invoice: {
        number: "198",
        date: "2026-09-02T00:00:00Z",
        fullyPaidAt: "2026-09-28T00:00:00Z",
      },
    },
    fmt,
  );
  assert.equal(copy.title, "Вернуть отчёт в «Ждём оплаты»?");
  assert.equal(copy.variant, "warning");
  assert.equal(
    copy.note,
    "Отметка об оплате от <2026-09-28> будет снята. Счёт 198 от <2026-09-02> останется на отчёте.",
  );
});

test("строка отчёта превращается в предмет диалога без потерь", () => {
  const subject = subjectOfReport({
    _id: "r7",
    status: "awaitingPayment",
    company: {
      _id: "c1",
      alias: "Вектор Логистик",
      fullTitle: "ООО «Вектор Логистик»",
    },
    servicePlan: { _id: "s1", title: "Поддержка 1С" },
    period: "июль 2026",
    total: 48000,
    worksCount: 12,
    invoice: { number: "214", date: "2026-09-15T00:00:00Z" },
    approval: {
      required: true,
      bySubdivisions: false,
      finalApprover: { _id: "u1", firstName: "Олег", lastName: "Кузнецов" },
    },
    awaiting: null,
    lastRemindedAt: null,
    customerApprovedAt: "2026-09-03T02:00:00Z",
  });

  assert.equal(subject.id, "r7");
  assert.equal(subject.status, "awaitingPayment");
  // В списке компания названа коротко — так же её называет и диалог
  assert.equal(subject.company, "Вектор Логистик");
  assert.equal(subject.servicePlan, "Поддержка 1С");
  assert.equal(subject.period, "июль 2026");
  assert.equal(subject.total, 48000);
  assert.equal(subject.worksCount, 12);
  assert.equal(subject.invoice.number, "214");
  assert.equal(subject.approval.required, true);
  assert.equal(subject.customerApprovedAt, "2026-09-03T02:00:00Z");
  assert.equal(subject.preview, undefined);
});

test("строка превью несёт состав будущего отчёта и срок ответа", () => {
  const row = {
    month: "2026-09",
    company: { _id: "c2", alias: "Северный берег" },
    servicePlan: { _id: "s2", title: "Поддержка 1С" },
    approval: {
      required: true,
      bySubdivisions: false,
      approver: { _id: "u1", firstName: "Олег", lastName: "Кузнецов" },
    },
    worksCount: 18,
    workIds: ["w1", "w2"],
    total: 64200,
  };
  const subject = subjectOfPreview(row, {
    period: "сентябрь 2026",
    sendDeadlineAt: "2026-10-08T13:59:59Z",
  });

  assert.equal(subject.id, null);
  assert.equal(subject.status, "preview");
  assert.equal(subject.period, "сентябрь 2026");
  assert.deepEqual(subject.preview, {
    companyId: "c2",
    servicePlanId: "s2",
    workIds: ["w1", "w2"],
  });
  assert.equal(subject.approval.finalApprover.lastName, "Кузнецов");
  assert.equal(subject.sendDeadlineAt, "2026-10-08T13:59:59Z");
});

test("услуге без согласования срок ответа не нужен", () => {
  const subject = subjectOfPreview(
    {
      month: "2026-09",
      company: { _id: "c3", alias: "Медлайн" },
      servicePlan: { _id: "s3", title: "Сопровождение сети" },
      approval: { required: false, bySubdivisions: false, approver: null },
      worksCount: 7,
      workIds: ["w9"],
      total: 14300,
    },
    { period: "сентябрь 2026", sendDeadlineAt: "2026-10-08T13:59:59Z" },
  );
  assert.equal(subject.sendDeadlineAt, null);
});

test("архив: отчёт уходит из конвейера, и диалог это называет", () => {
  const copy = stageActionCopy(
    "archive",
    {
      ...base,
      status: "paid",
      invoice: { number: "198", fullyPaidAt: "2026-09-28T00:00:00Z" },
    },
    fmt,
  );
  assert.equal(copy.title, "Отправить отчёт в архив?");
  assert.equal(copy.confirmLabel, "В архив");
  assert.equal(copy.variant, "default");
  assert.equal(
    copy.note,
    "Отчёт уйдёт из конвейера: в списках стадий его больше не будет. Вернуть его можно из этой карточки.",
  );
});

test("возврат из архива ничего не снимает", () => {
  const archived = {
    ...base,
    status: "archived",
    invoice: {
      number: "198",
      date: "2026-09-02T00:00:00Z",
      fullyPaidAt: "2026-09-28T00:00:00Z",
    },
  };
  const copy = stageActionCopy("rollback", archived, fmt);
  assert.equal(copy.title, "Вернуть отчёт в «Оплачен»?");
  assert.equal(copy.confirmLabel, "Вернуть");
  assert.equal(copy.variant, "default");
  assert.equal(
    copy.note,
    "Отчёт вернётся из архива в конвейер, на стадию «Оплачен». Счёт и отметка об оплате сохранятся.",
  );
  // В сводке архивного отчёта — та же дата оплаты, что была на стадии «Оплачен»
  assert.equal(
    subjectMeta(archived, fmt),
    "Абонентское обслуживание · август 2026 · оплачен <2026-09-28>",
  );
});
