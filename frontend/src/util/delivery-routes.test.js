// node --test src/util/delivery-routes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFY_ROUTE,
  chronicleAuthorName,
  deliveryStatusMeta,
  dialogLabel,
  dialogRoute,
  initialRoute,
  routeSubtitle,
  routeTitle,
  routeTriggerLabel,
} from "./delivery-routes.js";

const marina = {
  conversationId: "c-marina",
  network: "telegram",
  kind: "direct",
  title: "Соколова Марина",
  available: true,
  reason: null,
  boundHere: true,
};
const group = {
  conversationId: "c-group",
  network: "telegram",
  kind: "group",
  title: "ТД Восток × F1Lab",
  available: true,
  reason: null,
  boundHere: false,
};
const busy = {
  conversationId: "c-wa",
  network: "whatsapp",
  kind: "direct",
  title: "",
  available: false,
  reason: "занят заявкой №56790",
  boundHere: false,
};

test("пункты меню: заголовок и подпись как на канве D1", () => {
  assert.equal(routeTitle(marina, "Соколова Марина"), "Telegram · Соколова Марина");
  assert.equal(routeTitle(busy, "Соколова Марина"), "WhatsApp · Соколова Марина");
  assert.equal(routeSubtitle(marina), "личный чат · привязан к этой заявке");
  assert.equal(routeSubtitle({ ...marina, boundHere: false }), "личный чат");
  assert.equal(routeSubtitle(group), "группа компании");
  assert.equal(routeSubtitle(busy), "занят заявкой №56790");
});

test("кнопка выбора: короткое имя или «Почта и бот HD»", () => {
  assert.equal(routeTriggerLabel(marina, ""), "Telegram · Соколова М.");
  assert.equal(routeTriggerLabel(null, ""), "Почта и бот HD");
  assert.equal(routeTriggerLabel({ ...marina, title: "" }, ""), "Telegram · собеседник");
});

test("initialRoute: занятый или пропавший маршрут не выбирается — «как сейчас»", () => {
  assert.equal(
    initialRoute({ routes: [marina, busy], defaultRoute: "c-marina", applicantName: "" }),
    "c-marina",
  );
  assert.equal(
    initialRoute({ routes: [marina, busy], defaultRoute: "c-wa", applicantName: "" }),
    NOTIFY_ROUTE,
  );
  assert.equal(
    initialRoute({ routes: [marina], defaultRoute: "c-gone", applicantName: "" }),
    NOTIFY_ROUTE,
  );
  assert.equal(
    initialRoute({ routes: [marina], defaultRoute: NOTIFY_ROUTE, applicantName: "" }),
    NOTIFY_ROUTE,
  );
  assert.equal(initialRoute(null), NOTIFY_ROUTE);
});

test("dialogRoute: привязанный чат, иначе чат последнего входящего", () => {
  const comments = [
    { createdAt: "2026-09-25T06:00:00Z", channel: { conversationId: "c-group", direction: "in" } },
    { createdAt: "2026-09-25T07:00:00Z", channel: { conversationId: "c-marina", direction: "out" } },
    { createdAt: "2026-09-25T05:00:00Z", channel: null },
  ];
  assert.equal(dialogRoute([marina, group], comments), marina);
  assert.equal(dialogRoute([{ ...marina, boundHere: false }, group], comments), group);
  assert.equal(dialogRoute([group], []), null);
  assert.equal(dialogRoute(null, comments), null);
});

test("dialogLabel: сеть и вид чата", () => {
  assert.equal(dialogLabel(marina), "Telegram · личный чат");
  assert.equal(dialogLabel(group), "Telegram · группа");
});

test("chronicleAuthorName: без хвоста сети, «с телефона» остаётся, иначе автор", () => {
  assert.equal(
    chronicleAuthorName({ channel: { network: "telegram", authorName: "Андрей · Telegram" } }, "Служба техподдержки"),
    "Андрей",
  );
  assert.equal(
    chronicleAuthorName(
      { channel: { network: "telegram", authorName: "F1Lab Поддержка · с телефона" } },
      "Служба техподдержки",
    ),
    "F1Lab Поддержка · с телефона",
  );
  // Связанный клиент: подписи нет — имя автора комментария
  assert.equal(
    chronicleAuthorName({ channel: { network: "telegram", direction: "in" } }, "Соколова Марина"),
    "Соколова Марина",
  );
  assert.equal(chronicleAuthorName({ channel: null }, "Лебедев Игорь"), "Лебедев Игорь");
  // Имя, совпадающее с хвостом целиком, не превращается в пустоту
  assert.equal(
    chronicleAuthorName({ channel: { network: "telegram", authorName: " · Telegram" } }, "x"),
    "· Telegram",
  );
});

test("chronicleAuthorName: письмо от незарегистрированного отправителя — realSender заявки, никогда имя служебной учётки", () => {
  const mail = {
    channel: null,
    createdBy: { firstName: "Служба", lastName: "поддержки", isServiceAccount: true },
  };
  assert.equal(
    chronicleAuthorName(mail, "Служба поддержки", '"Иванов Пётр" <petr@corp.ru>'),
    "Иванов Пётр <petr@corp.ru>",
  );
  // Без адреса в realSender (не распознан) — строка как есть
  assert.equal(chronicleAuthorName(mail, "Служба поддержки", "Андрей"), "Андрей");
  // realSender не пришёл (не сотруднику) — «Отправитель письма», не имя учётки
  assert.equal(chronicleAuthorName(mail, "Служба поддержки", ""), "Отправитель письма");
  // С блоком канала (ответ «с телефона») — обычные правила, realSender не при чём
  const fromPhone = {
    channel: { network: "telegram", authorName: "F1Lab Поддержка · с телефона" },
    createdBy: { isServiceAccount: true },
  };
  assert.equal(
    chronicleAuthorName(fromPhone, "x", "Иванов Пётр"),
    "F1Lab Поддержка · с телефона",
  );
});

test("deliveryStatusMeta: каждый статус — свой значок и тон", () => {
  assert.equal(deliveryStatusMeta("read").tone, "accent");
  assert.equal(deliveryStatusMeta("read").icon, "double");
  assert.equal(deliveryStatusMeta("delivered").tone, "faint");
  assert.equal(deliveryStatusMeta("sent").icon, "check");
  assert.equal(deliveryStatusMeta("queued").icon, "clock");
  assert.equal(deliveryStatusMeta("preparing").icon, "clock");
  assert.equal(deliveryStatusMeta("failed").label, "Не доставлено");
  assert.equal(deliveryStatusMeta(undefined), null);
});
