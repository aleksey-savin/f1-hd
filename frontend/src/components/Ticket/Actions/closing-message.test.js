// node --test src/components/Ticket/Actions/closing-message.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OUTCOMES,
  chipState,
  greetingAt,
  toggleGreeting,
  togglePart,
  toggleSignOff,
  workSentences,
} from "./closing-message.ts";

const WORKS = ["Обновил платформу 1С.", "Проверил вход в базу."];

test("the greeting follows the applicant's hour", () => {
  assert.equal(greetingAt(5), "Доброе утро!");
  assert.equal(greetingAt(11), "Доброе утро!");
  assert.equal(greetingAt(12), "Добрый день!");
  assert.equal(greetingAt(17), "Добрый день!");
  assert.equal(greetingAt(18), "Добрый вечер!");
  assert.equal(greetingAt(0), "Добрый вечер!");
  assert.equal(greetingAt(4), "Добрый вечер!");
});

test("finished works become sentences, without junk and repeats", () => {
  const works = [
    { description: "обновил  платформу\n1С", finishedAt: "2026-09-13" },
    { description: "Обновил платформу 1С.", finishedAt: "2026-09-13" },
    { description: "-", finishedAt: "2026-09-13" },
    { description: "запланировано на завтра", finishedAt: null },
    { finishedAt: "2026-09-13" },
    { description: "Проверил вход в базу!", finishedAt: "2026-09-13" },
  ];
  assert.deepEqual(workSentences(works), [
    "Обновил платформу 1С.",
    "Проверил вход в базу!",
  ]);
});

test("the greeting goes to the start and comes off whichever was typed", () => {
  assert.equal(
    toggleGreeting("Проверил вход в базу.", "Добрый вечер!"),
    "Добрый вечер! Проверил вход в базу.",
  );
  assert.equal(toggleGreeting("Доброе утро! Готово.", "Добрый день!"), "Готово.");
});

test("the sign-off goes to the end and closes the sentence before it", () => {
  assert.equal(toggleSignOff("Принтер работает"), "Принтер работает. Хорошего дня!");
  assert.equal(toggleSignOff("Принтер работает. Хорошего дня!"), "Принтер работает.");
});

test("a work goes after text typed by hand", () => {
  assert.equal(
    togglePart("Принтер работает", WORKS[0], WORKS),
    "Принтер работает. Обновил платформу 1С.",
  );
});

test("works stack in chip order and stay before the sign-off", () => {
  let text = toggleSignOff(toggleGreeting("", "Добрый день!"));
  text = togglePart(text, WORKS[1], WORKS);
  text = togglePart(text, WORKS[0], WORKS);
  assert.equal(
    text,
    "Добрый день! Обновил платформу 1С. Проверил вход в базу. Хорошего дня!",
  );
  assert.equal(
    togglePart(text, WORKS[0], WORKS),
    "Добрый день! Проверил вход в базу. Хорошего дня!",
  );
});

test("the outcome lines are «Работы по заявке выполнены.» and «Проблема устранена.»", () => {
  assert.deepEqual(OUTCOMES, [
    "Работы по заявке выполнены.",
    "Проблема устранена.",
  ]);
});

test("outcomes go after the works, in chip order, and come off again", () => {
  const order = [...WORKS, ...OUTCOMES];

  let text = toggleSignOff(toggleGreeting("", "Добрый день!"));
  text = togglePart(text, OUTCOMES[1], order);
  text = togglePart(text, OUTCOMES[0], order);
  text = togglePart(text, WORKS[0], order);
  assert.equal(
    text,
    "Добрый день! Обновил платформу 1С. Работы по заявке выполнены. Проблема устранена. Хорошего дня!",
  );
  assert.equal(chipState(text).has(OUTCOMES[0]), true);

  assert.equal(
    togglePart(text, OUTCOMES[0], order),
    "Добрый день! Обновил платформу 1С. Проблема устранена. Хорошего дня!",
  );
});

test("a chip is lit exactly when its text is in the message", () => {
  const state = chipState("Добрый вечер! Обновил платформу 1С. Хорошего дня!");
  assert.equal(state.greeting, "Добрый вечер!");
  assert.equal(state.signOff, true);
  assert.equal(state.has(WORKS[0]), true);
  assert.equal(state.has(WORKS[1]), false);
  assert.equal(chipState("Добрый день").greeting, "");
});
