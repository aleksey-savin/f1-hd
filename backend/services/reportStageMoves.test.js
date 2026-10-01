// node --test services/reportStageMoves.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  customerApprovedAt,
  lastRemindedAt,
  rollbackPlan,
} = require("./reportStageMoves");

test("оплаченный отчёт возвращается в «Ждём оплаты»: снимается только отметка об оплате", () => {
  const plan = rollbackPlan({
    status: "paid",
    invoice: { number: "214", date: new Date("2026-09-15"), fullyPaidAt: new Date("2026-09-28") },
  });

  assert.equal(plan.kind, "step");
  assert.equal(plan.status, "awaitingPayment");
  // Счёт остаётся на отчёте — возврат на ОДНУ стадию
  assert.deepEqual(plan.unsetInvoice, ["fullyPaidAt"]);
  assert.equal(plan.comment, "«Ждём оплаты»: отметка об оплате снята");
});

test("отчёт со счётом возвращается в «Сформировать счёт»: счёт снимается", () => {
  const plan = rollbackPlan({
    status: "awaitingPayment",
    invoice: { number: "214", date: new Date("2026-09-15") },
  });

  assert.equal(plan.kind, "step");
  assert.equal(plan.status, "approved");
  assert.deepEqual(plan.unsetInvoice, ["number", "date"]);
  // Номер снятого счёта остаётся в истории — иначе не восстановить, что было
  assert.equal(plan.comment, "«Сформировать счёт»: счёт 214 снят");
});

test("счёт без номера снимается без пустого места в записи истории", () => {
  const plan = rollbackPlan({ status: "awaitingPayment", invoice: {} });
  assert.equal(plan.comment, "«Сформировать счёт»: счёт снят");
});

test("до счёта отчёт расформировывается в превью", () => {
  for (const status of ["approved", "pendingApproval", "declined"]) {
    assert.equal(rollbackPlan({ status }).kind, "dissolve", status);
  }
});

test("об отзыве пишем согласующим, только пока отчёт ждёт их подписи", () => {
  assert.equal(rollbackPlan({ status: "pendingApproval" }).notifyApprovers, true);
  // Утверждённый и отклонённый никого не ждут: живых ссылок у клиента нет
  assert.equal(rollbackPlan({ status: "approved" }).notifyApprovers, false);
  assert.equal(rollbackPlan({ status: "declined" }).notifyApprovers, false);
});

test("отчёт из архива возвращается в «Оплачен», ничего не теряя", () => {
  const plan = rollbackPlan({
    status: "archived",
    invoice: { number: "214", fullyPaidAt: new Date("2026-09-28") },
  });

  assert.equal(plan.kind, "step");
  assert.equal(plan.status, "paid");
  // Счёт и отметка об оплате остаются: архив — это только «убрано с глаз»
  assert.deepEqual(plan.unsetInvoice, []);
  assert.equal(plan.comment, "«Оплачен» из архива");
});

test("у неизвестного состояния плана нет", () => {
  // Отказ словами формулирует вызывающий (services/reportApproval)
  assert.equal(rollbackPlan({ status: "preview" }), null);
});

test("последнее напоминание — самое позднее из ручных и автоматических", () => {
  const report = {
    timeline: [
      { action: "submitted", at: new Date("2026-09-20T03:00:00Z") },
      { action: "reminded", actor: "system", at: new Date("2026-09-26T03:00:00Z") },
      { action: "reminded", actor: "contractor", at: new Date("2026-09-28T05:00:00Z") },
      { action: "approved", at: new Date("2026-09-29T05:00:00Z") },
    ],
  };
  assert.deepEqual(lastRemindedAt(report), new Date("2026-09-28T05:00:00Z"));
});

test("напоминаний не было — даты нет", () => {
  assert.equal(lastRemindedAt({ timeline: [{ action: "submitted", at: new Date() }] }), null);
  assert.equal(lastRemindedAt({}), null);
});

test("дата согласования клиентом — финальная подпись или автосогласование", () => {
  const signed = {
    timeline: [
      { action: "submitted", actor: "contractor", at: new Date("2026-09-01T03:00:00Z") },
      // Подпись части — ещё не согласование отчёта
      { action: "approved", actor: "customer", scope: "subdivision", at: new Date("2026-09-02T03:00:00Z") },
      { action: "approved", actor: "customer", scope: "report", at: new Date("2026-09-03T03:00:00Z") },
      { action: "invoiced", actor: "contractor", at: new Date("2026-09-05T03:00:00Z") },
    ],
  };
  assert.deepEqual(customerApprovedAt(signed), new Date("2026-09-03T03:00:00Z"));

  const bySilence = {
    timeline: [{ action: "autoApproved", actor: "system", scope: "report", at: new Date("2026-09-08T14:00:00Z") }],
  };
  assert.deepEqual(customerApprovedAt(bySilence), new Date("2026-09-08T14:00:00Z"));
});

test("услуга без согласования: утвердили мы сами — подписи клиента нет", () => {
  const ours = {
    timeline: [{ action: "approved", actor: "contractor", scope: "report", at: new Date("2026-09-01T03:00:00Z") }],
  };
  assert.equal(customerApprovedAt(ours), null);
  assert.equal(customerApprovedAt({}), null);
});
