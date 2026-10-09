// node --test controllers/finances/approval.access.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

const ServicePlanReport = require("@/models/finances/servicePlanReport");
const reportApproval = require("@/services/reportApproval");
const approvalScope = require("@/services/reportApprovalScope");

/**
 * Что уходит в ответ на действие с отчётом согласования. Сборку ответа
 * проверяет services/approvalActionResult.test.js; здесь — что КАЖДАЯ ручка ею
 * пользуется: тест чистой функции не поймает контроллер, который вернул
 * `{ report }` мимо неё.
 *
 * Службы, что ходят в базу, контроллер забирает деструктуризацией при ЗАГРУЗКЕ —
 * подменять их позже поздно, поэтому подмена стоит до `require`. Каждая пишет
 * вызов в `calls`: действие должно быть выполнено, а ответ собран после него.
 * Появится у контроллера новая служба — подменить её здесь же.
 */

const calls = [];
// Документ, с которым «работают» службы: его отдают и findById, и createReport
let report = null;

const record =
  (name) =>
  async (args) => {
    calls.push([name, args]);
  };

reportApproval.createReport = async (args) => {
  calls.push(["createReport", args]);
  return report;
};
reportApproval.resubmit = record("resubmit");
reportApproval.issueInvoice = record("issueInvoice");
reportApproval.confirmPayment = record("confirmPayment");
reportApproval.archiveReport = record("archiveReport");
reportApproval.decide = record("decide");
reportApproval.remindApprovers = record("remindApprovers");
// Откат: отчёт остаётся (шаг назад) или распускается (до счёта) — тогда null
let rollbackKeeps = true;
reportApproval.rollbackReport = async (args) => {
  calls.push(["rollbackReport", args]);
  return rollbackKeeps ? report : null;
};
// Подписывающему отчёт виден: сам скоуп проверяется в services/reportApprovalScope
approvalScope.resolveReportApprovalScope = async () => ({
  canSeeReport: () => true,
});

const controller = require("./approval");

const originals = { findById: ServicePlanReport.findById };

afterEach(() => {
  ServicePlanReport.findById = originals.findById;
  calls.length = 0;
  report = null;
  rollbackKeeps = true;
});

// Персональные ссылки согласующих: документ отчёта их несёт, в ответ они
// попасть не должны
const SECRETS = ["sibling-branch-token", "final-approver-token"];

const reportWithTokens = () =>
  new ServicePlanReport({
    status: "pendingApproval",
    accessTokens: SECRETS.map((token) => ({
      token,
      user: {
        _id: new mongoose.Types.ObjectId(),
        firstName: "Анна",
        lastName: "Соколова",
      },
      subdivision: new mongoose.Types.ObjectId(),
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    })),
  });

const call = async (handler, { params = {}, body = {} } = {}) => {
  let failure = null;
  let sent = null;
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      sent = { status: this.statusCode, payload };
      return this;
    },
  };
  const auth = { legacy: { _id: "66aa00000000000000000001" } };
  await handler({ params, body, auth }, res, (error) => {
    failure = error;
  });
  return { failure, sent };
};

test("premise: the report document serialises with every access token", () => {
  // Без этого остальные тесты прошли бы и на документе, чьи токены не
  // сериализуются, — молча ничего не доказав
  const wire = JSON.stringify(reportWithTokens());

  for (const secret of SECRETS) {
    assert.ok(wire.includes(secret), `${secret} is missing from the document`);
  }
});

// Ручка, статус успешного ответа, тело запроса и служба, что делает действие
const ACTIONS = [
  [
    "create",
    201,
    { companyId: "66bb00000000000000000001", servicePlanId: "66bb00000000000000000002", workIds: [] },
    "createReport",
  ],
  ["resubmit", 200, { workIds: [] }, "resubmit"],
  ["invoice", 200, { number: "17", date: "2026-09-30" }, "issueInvoice"],
  ["payment", 200, { paidAt: "2026-09-30" }, "confirmPayment"],
  ["archive", 200, {}, "archiveReport"],
  ["decision", 200, { approve: true }, "decide"],
  ["remind", 200, {}, "remindApprovers"],
  ["rollback", 200, {}, "rollbackReport"],
];

for (const [handler, status, body, service] of ACTIONS) {
  test(`${handler}: answers { ok, id } and never the report with its access tokens`, async () => {
    report = reportWithTokens();
    ServicePlanReport.findById = async () => report;

    const { failure, sent } = await call(controller[handler], {
      params: { id: String(report._id) },
      body,
    });

    assert.equal(failure, null);
    assert.equal(sent.status, status);
    // Главное: по сети не уходит ни токен, ни поле, где он лежит
    assert.doesNotMatch(JSON.stringify(sent.payload), /token/i);
    // И ровно такой ответ, какого ждёт интерфейс
    assert.deepEqual(sent.payload, { ok: true, id: String(report._id) });
    // Действие выполнено, ответ собран после него
    assert.deepEqual(
      calls.map(([name]) => name),
      [service],
    );
  });
}

test("rollback that dissolves the report answers { dissolved: true } and nothing else", async () => {
  // До счёта откат распускает отчёт: работы уходят в превью, документа больше нет
  report = reportWithTokens();
  ServicePlanReport.findById = async () => report;
  rollbackKeeps = false;

  const { failure, sent } = await call(controller.rollback, {
    params: { id: String(report._id) },
  });

  assert.equal(failure, null);
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.payload, { dissolved: true });
  assert.deepEqual(
    calls.map(([name]) => name),
    ["rollbackReport"],
  );
});
