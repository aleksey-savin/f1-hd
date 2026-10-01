/**
 * Ручные ходы нашей стороны по конвейеру «Согласования работ»: возврат отчёта
 * на стадию назад и напоминание согласующим.
 *
 * Здесь только РЕШЕНИЕ — что с отчётом произойдёт. Запись в базу и
 * уведомления делает services/reportApproval: так правило перехода читается
 * целиком и проверяется без базы. Модуль намеренно ничего не подключает.
 */

/**
 * Что значит «вернуть на стадию назад» для отчёта в его нынешнем состоянии.
 *
 * После счёта возврат — ровно один шаг: отчёт выходит из архива, снимается
 * отметка об оплате либо сам счёт; состав работ и подписи клиента остаются.
 *
 * До счёта шага назад нет: стадии «превью» у документа не существует, превью —
 * это работы, ещё не вошедшие ни в один отчёт. Поэтому отчёт расформировывается
 * (`dissolve`), а работы возвращаются в подбор. Утверждённый отчёт тоже идёт в
 * превью, а не «на утверждение»: возвращают его, чтобы поправить состав, и
 * просить клиента подписать тот же документ второй раз незачем.
 */
const rollbackPlan = (report) => {
  switch (report.status) {
    // Архив — не стадия, а «убрано с глаз»: возврат ничего не снимает
    case "archived":
      return {
        kind: "step",
        status: "paid",
        unsetInvoice: [],
        comment: "«Оплачен» из архива",
      };
    case "paid":
      return {
        kind: "step",
        status: "awaitingPayment",
        unsetInvoice: ["fullyPaidAt"],
        comment: "«Ждём оплаты»: отметка об оплате снята",
      };
    case "awaitingPayment": {
      const number = report.invoice?.number;
      return {
        kind: "step",
        status: "approved",
        unsetInvoice: ["number", "date"],
        comment: `«Сформировать счёт»: счёт ${number ? `${number} ` : ""}снят`,
      };
    }
    case "approved":
    case "pendingApproval":
    case "declined":
      return {
        kind: "dissolve",
        // Живые ссылки есть только у тех, чьей подписи отчёт ждёт прямо сейчас
        notifyApprovers: report.status === "pendingApproval",
      };
    // Неизвестное состояние: плана нет, отказ словами формулирует вызывающий
    default:
      return null;
  }
};

/** Когда согласующим напоминали в последний раз — вручную или по сроку. */
const lastRemindedAt = (report) =>
  (report.timeline || [])
    .filter((event) => event.action === "reminded" && event.at)
    .reduce(
      (latest, event) => (!latest || event.at > latest ? event.at : latest),
      null,
    );

/**
 * Когда клиент согласовал отчёт целиком: его финальная подпись либо
 * автосогласование по сроку. Подписи отдельных частей и наше собственное
 * «утверждено» (услуга без согласования) сюда не входят — терять при
 * расформировании там нечего.
 */
const customerApprovedAt = (report) =>
  (report.timeline || [])
    .filter(
      (event) =>
        event.at &&
        (event.action === "autoApproved" ||
          (event.action === "approved" &&
            event.actor === "customer" &&
            event.scope !== "subdivision")),
    )
    .reduce(
      (latest, event) => (!latest || event.at > latest ? event.at : latest),
      null,
    );

module.exports = { customerApprovedAt, lastRemindedAt, rollbackPlan };
