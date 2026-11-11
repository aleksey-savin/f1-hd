import assert from "node:assert/strict";
import { test } from "node:test";

import {
  phoneRecipient,
  startAction,
  startRoutes,
  readPendingStart,
  pendingStartSnapshot,
  inboxOutletState,
  canResetRejectedStart,
  pendingAfterStartFailure,
  pendingAfterAbandon,
} from "./new-conversation.ts";

const phoneRoute = {
  id: "phone:tg",
  channelId: "tg",
  network: "telegram",
  kind: "direct",
  title: "",
  target: "phone",
  conversationId: null,
  available: true,
  reason: null,
  boundHere: false,
};
const existing = {
  ...phoneRoute,
  id: "chat",
  target: "conversation",
  conversationId: "chat",
};
const recipient = {
  userId: null,
  name: "+7 (914) 555-01-42",
  phone: "+79145550142",
};
const clientRequestId = "7725ee15-013e-48e8-82e5-0cb897cf9e2e";

test("шторкой нового диалога владеет список; формы внутри переписки остаются у переписки", () => {
  assert.deepEqual(inboxOutletState(undefined), {
    selectedId: null,
    ownsSheet: true,
  });
  assert.deepEqual(inboxOutletState("new"), {
    selectedId: null,
    ownsSheet: true,
  });
  // /conversations/:id/* preserves the same id for thread, tickets/add and users/add.
  assert.deepEqual(inboxOutletState("existing-thread"), {
    selectedId: "existing-thread",
    ownsSheet: false,
  });
});

test("новый ключ разрешён только после однозначного отказа start; таймаут и ошибка сети неоднозначны", () => {
  assert.equal(canResetRejectedStart(400), true);
  assert.equal(canResetRejectedStart(409), true);
  assert.equal(canResetRejectedStart(408), false);
  assert.equal(canResetRejectedStart(500), false);
  assert.equal(canResetRejectedStart(undefined), false);
});

test("подтверждённый отказ start не восстанавливает заблокированного получателя; неизвестный исход и принятое сообщение сохраняются", () => {
  const request = { clientRequestId, recipient };
  assert.equal(pendingAfterStartFailure(request, 400), null);
  assert.equal(readPendingStart(pendingAfterStartFailure(request, 409)), null);
  const ambiguous = pendingAfterStartFailure(request, undefined);
  assert.deepEqual(readPendingStart(pendingStartSnapshot(ambiguous)), request);
  assert.deepEqual(pendingAfterStartFailure(request, 400, true), request);
  assert.deepEqual(
    readPendingStart(
      pendingStartSnapshot(pendingAfterStartFailure(request, 409, true)),
    ),
    request,
  );
  const accepted = { ...request, messageId: "accepted" };
  assert.deepEqual(pendingAfterStartFailure(accepted, 409), accepted);
});

test("другой диалог можно начать после подтверждённой неудачи; неизвестная и ещё ожидающая отправка сохраняется", () => {
  const request = { clientRequestId, recipient, messageId: "accepted" };
  assert.equal(
    pendingAfterAbandon(request, { messageId: "accepted", status: "failed" }),
    null,
  );
  assert.equal(
    pendingAfterAbandon(request, { messageId: "accepted", status: "queued" }),
    request,
  );
  assert.equal(
    pendingAfterAbandon(request, { messageId: "another", status: "failed" }),
    request,
  );
  assert.equal(pendingAfterAbandon(request, null), request);
});

test("номер выбирается без карточки пользователя; имя с цифрами не превращается в адрес", () => {
  assert.deepEqual(phoneRecipient("8 (914) 555-01-42"), recipient);
  assert.equal(phoneRecipient("Алексей 9145550142"), null);
  assert.equal(phoneRecipient("+7"), null);
  assert.equal(phoneRecipient("791455501421234"), null);
  assert.equal(phoneRecipient("+49 30 901820").phone, "+4930901820");
});

test("сеть представлена один раз: доступный личный чат важнее первого контакта и погашенного бота", () => {
  const bot = {
    ...phoneRoute,
    id: "bot",
    available: false,
    reason: "Бот не может писать первым",
  };
  const group = { ...existing, id: "group", kind: "group" };
  assert.deepEqual(startRoutes([bot, phoneRoute, existing, group]), [existing]);
  assert.deepEqual(startRoutes([bot, phoneRoute]), [phoneRoute]);
  assert.deepEqual(startRoutes([bot]), [bot]);
});

test("принятое сообщение всегда проверяется или повторяется по id; новый start невозможен", () => {
  assert.equal(
    startAction({ messageId: "accepted", status: "queued" }, phoneRoute),
    "poll",
  );
  assert.equal(
    startAction({ messageId: "accepted", status: "failed" }, phoneRoute),
    "retry",
  );
  assert.equal(
    startAction({ messageId: "accepted", status: "failed" }, existing),
    "retry",
  );
  assert.equal(startAction(null, existing), "open");
  assert.equal(startAction(null, phoneRoute), "start");
  assert.equal(
    startAction(null, { ...phoneRoute, available: false }),
    "blocked",
  );
  assert.equal(startAction(null, null), "blocked");
});

test("восстановление принятого сообщения не хранит текст, файлы и прочие поля", () => {
  const snapshot = pendingStartSnapshot({
    clientRequestId,
    messageId: "accepted",
    recipient,
    text: "private",
    attachments: ["blob"],
    secret: "private",
  });
  assert.deepEqual(JSON.parse(snapshot), {
    clientRequestId,
    messageId: "accepted",
    recipient,
  });
  assert.deepEqual(readPendingStart(snapshot), {
    clientRequestId,
    messageId: "accepted",
    recipient,
  });
  assert.deepEqual(
    readPendingStart(pendingStartSnapshot({ clientRequestId, recipient })),
    { clientRequestId, recipient },
  );
  assert.equal(readPendingStart("{broken"), null);
  assert.equal(
    readPendingStart(
      JSON.stringify({
        clientRequestId,
        messageId: "accepted",
        recipient: { name: "x" },
      }),
    ),
    null,
  );
  assert.equal(
    readPendingStart(
      JSON.stringify({ clientRequestId, messageId: "", recipient }),
    ),
    null,
  );
  assert.equal(
    readPendingStart(
      JSON.stringify({ clientRequestId: "not-a-uuid", recipient }),
    ),
    null,
  );
});
