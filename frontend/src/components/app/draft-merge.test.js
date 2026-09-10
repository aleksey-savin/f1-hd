// node --test src/components/app/draft-merge.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { changedKeys, mergeDraft } from "./draft-merge.ts";

const entry = (payload, baseline) => ({ payload, baseline });

test("правка — только изменившийся ключ верхнего уровня", () => {
  const current = { timezone: "Asia/Omsk", taxi: { operator: "" } };
  const baseline = { timezone: "Europe/Moscow", taxi: { operator: "" } };

  assert.deepEqual(changedKeys(current, baseline), ["timezone"]);
});

test("ключ, который секция перестала присылать, правкой не считается", () => {
  const current = { mailbox: { isActive: true } };
  const baseline = {
    mailbox: { isActive: true },
    defaultApplicant: { _id: "1" },
  };

  assert.deepEqual(changedKeys(current, baseline), []);
});

test("нетронутая секция в тело не попадает", () => {
  const same = { modules: { finances: { isActive: true } } };

  assert.deepEqual(mergeDraft([entry(same, structuredClone(same))]), {});
});

test("чужая группа не едет: «Основные» без правки такси шлют один timezone", () => {
  const payload = {
    timezone: "Asia/Omsk",
    contacts: { title: "Ромашка" },
    taxi: { operator: "yandexgo" },
  };
  const baseline = {
    timezone: "Europe/Moscow",
    contacts: { title: "Ромашка" },
    taxi: { operator: "yandexgo" },
  };

  assert.deepEqual(mergeDraft([entry(payload, baseline)]), {
    timezone: "Asia/Omsk",
  });
});

test("две секции на одной группе: каждая приносит только своё поле", () => {
  // «Финансы»: поменяли коэффициент буднего дня, праздничный несут как есть
  const finances = entry(
    { overtime: { weekdayCoefficient: 2, holidayCoefficient: 1.5 } },
    { overtime: { weekdayCoefficient: 1, holidayCoefficient: 1.5 } },
  );
  // «Производственный календарь»: поменяли праздничный, будний несут снимком
  const calendar = entry(
    { overtime: { weekdayCoefficient: 1, holidayCoefficient: 3 } },
    { overtime: { weekdayCoefficient: 1, holidayCoefficient: 1.5 } },
  );

  assert.deepEqual(mergeDraft([finances, calendar]), {
    overtime: { weekdayCoefficient: 2, holidayCoefficient: 3 },
  });
});

test("одна секция группы держит её целиком — чужое поле не теряется", () => {
  const finances = entry(
    { overtime: { weekdayCoefficient: 2, holidayCoefficient: 1.5 } },
    { overtime: { weekdayCoefficient: 1, holidayCoefficient: 1.5 } },
  );

  assert.deepEqual(mergeDraft([finances]), {
    overtime: { weekdayCoefficient: 2, holidayCoefficient: 1.5 },
  });
});

test("правка в глубине группы видна", () => {
  const payload = { notify: { byEmail: { host: "smtp.new" } } };
  const baseline = { notify: { byEmail: { host: "smtp.old" } } };

  assert.deepEqual(mergeDraft([entry(payload, baseline)]), payload);
});

test("массив сравнивается по составу и порядку", () => {
  const base = { knowledgeBase: { moderators: ["a", "b"] } };

  assert.deepEqual(
    changedKeys({ knowledgeBase: { moderators: ["a", "b"] } }, base),
    [],
  );
  assert.deepEqual(
    changedKeys({ knowledgeBase: { moderators: ["b", "a"] } }, base),
    ["knowledgeBase"],
  );
});
