// node --test src/components/Ticket/ticket-applicants.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { applicantOptions } from "./ticket-applicants.js";

const ivan = { _id: "u1", lastName: "Иванов", company: "c1" };
const olga = { _id: "u2", lastName: "Ольгина", company: "c2" };
const engineer = { _id: "s1", lastName: "Инженеров", company: "c0" };
// Регламентные заявки заводит служебная учётка: сервер её в варианты не отдаёт
const scheduler = { _id: "svc", firstName: "Планировщик регламентных заданий" };

const ids = (list) => list.map((user) => user._id);

test("сотруднику — люди выбранной компании и те, кто ведёт заявки", () => {
  const list = applicantOptions({
    applicants: [ivan, olga, engineer],
    responsibles: [engineer],
    companyId: "c1",
  });
  assert.deepEqual(ids(list), ["u1", "s1"]);
});

test("клиенту список приходит уже суженным — отдаём как есть", () => {
  const list = applicantOptions({
    applicants: [ivan, olga],
    responsibles: [],
    companyId: "c1",
    isEndUser: true,
  });
  assert.deepEqual(ids(list), ["u1", "u2"]);
});

test("нынешний инициатор заявки есть в вариантах всегда", () => {
  // Иначе поле «Инициатор» у регламентной заявки пустое: значение в форме есть,
  // а показать его нечем — менеджер видит «заявка создана без инициатора»
  const list = applicantOptions({
    applicants: [ivan, engineer],
    responsibles: [engineer],
    companyId: "c1",
    current: scheduler,
  });
  assert.deepEqual(ids(list), ["svc", "u1", "s1"]);

  // Уже в списке — второй раз не добавляем
  assert.deepEqual(
    ids(
      applicantOptions({
        applicants: [ivan],
        responsibles: [],
        companyId: "c1",
        current: ivan,
      }),
    ),
    ["u1"],
  );
  // У новой заявки нынешнего инициатора нет
  assert.deepEqual(
    ids(
      applicantOptions({ applicants: [ivan], companyId: "c1", current: null }),
    ),
    ["u1"],
  );
});

test("компания и инициатор могут прийти и объектом, и идентификатором", () => {
  const list = applicantOptions({
    applicants: [{ _id: "u9", company: { _id: "c1" } }],
    responsibles: [],
    companyId: "c1",
    current: "svc",
  });
  // Голый id без имени показать нечем — в варианты он не идёт
  assert.deepEqual(ids(list), ["u9"]);
});
