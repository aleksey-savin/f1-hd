// node --test src/util/mikrotik-changes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  actionLabel,
  applyDialog,
  approveHint,
  commandsAccusative,
  commandsCount,
  decisionNote,
  expiresPhrase,
  expiryLabel,
  firstRisky,
  listSummary,
  listWhen,
  expiredAfter,
  pendingNote,
  riskSentence,
  resultLine,
  riskReasonText,
  stepState,
  statusTone,
  stampLabel,
  STATUS_TEXT_TONE,
} from "./mikrotik-changes.ts";

// Запрос ИИ-агента на изменение Mikrotik: тоны статусов, подписи шагов, срок,
// строки результата команд и тексты диалогов. Пояс приходит параметром.

const TZ = "Europe/Moscow";
// 12:00 по Москве
const NOW = new Date("2026-10-10T09:00:00Z");
const at = (iso) => ({ now: NOW, timeZone: TZ, ...(iso ? { iso } : {}) });

test("статус -> тон: ждёт, применяется, применён, плохие, внимание, нейтральные", () => {
  assert.equal(statusTone("awaiting_requester"), "wait");
  assert.equal(statusTone("awaiting_responsible"), "wait");
  assert.equal(statusTone("queued"), "info");
  assert.equal(statusTone("applying"), "info");
  assert.equal(statusTone("applied"), "ok");
  for (const s of ["rolled_back", "rejected", "not_applied"])
    assert.equal(statusTone(s), "bad", s);
  assert.equal(statusTone("needs_attention"), "attention");
  assert.equal(statusTone("expired"), "idle");
  assert.equal(statusTone("cancelled"), "idle");
  assert.equal(statusTone("что-то новое"), "idle");
});

test("каждый тон ложится на тон цветного текста каталога устройств", () => {
  const known = ["ok", "warn", "info", "bad", "off"];
  for (const tone of ["wait", "info", "ok", "bad", "attention", "idle"]) {
    assert.ok(known.includes(STATUS_TEXT_TONE[tone]), tone);
  }
  assert.equal(STATUS_TEXT_TONE.attention, "warn");
});

test("подпись кнопки шага", () => {
  assert.equal(actionLabel("confirm"), "Подтвердить");
  assert.equal(actionLabel("approve"), "Утвердить");
  assert.equal(actionLabel(null), "");
  assert.equal(actionLabel(undefined), "");
});

test("срок: через сутки — «до завтра, 12:38», часы, минуты", () => {
  assert.equal(expiryLabel("2026-10-11T09:38:00Z", at()), "до завтра, 12:38");
  assert.equal(expiryLabel("2026-10-10T12:00:00Z", at()), "осталось 3 ч");
  assert.equal(expiryLabel("2026-10-10T09:25:00Z", at()), "осталось 25 мин");
  assert.equal(expiryLabel("2026-10-10T09:00:10Z", at()), "осталось 1 мин");
  assert.equal(expiryLabel("2026-10-10T16:00:00Z", at()), "до 19:00");
  assert.equal(expiryLabel("2026-10-13T09:38:00Z", at()), "до 13.10, 12:38");
  assert.equal(expiryLabel("2026-10-10T08:59:00Z", at()), "срок вышел");
  assert.equal(expiryLabel(undefined, at()), "");
});

test("срок в шапке: «истекает завтра в 12:38»", () => {
  assert.equal(
    expiresPhrase("2026-10-11T09:38:00Z", at()),
    "истекает завтра в 12:38",
  );
  assert.equal(
    expiresPhrase("2026-10-10T16:00:00Z", at()),
    "истекает сегодня в 19:00",
  );
  assert.equal(
    expiresPhrase("2026-10-13T09:38:00Z", at()),
    "истекает 13.10 в 12:38",
  );
  assert.equal(expiresPhrase("2026-10-10T08:00:00Z", at()), "срок вышел");
});

test("когда: строка списка и метка шага", () => {
  assert.equal(listWhen("2026-10-10T08:38:00Z", at()), "сегодня 11:38");
  assert.equal(listWhen("2026-10-08T08:38:00Z", at()), "8 октября");
  assert.equal(listWhen("2026-10-09T08:38:00Z", at()), "вчера");
  assert.equal(stampLabel("2026-10-10T08:41:00Z", at()), "11:41");
  assert.equal(stampLabel("2026-10-09T08:41:00Z", at()), "09.10, 11:41");
});

test("команд: числительное и винительный падеж для диалога", () => {
  assert.equal(commandsCount(1), "1 команда");
  assert.equal(commandsCount(3), "3 команды");
  assert.equal(commandsCount(5), "5 команд");
  assert.equal(commandsCount(11), "11 команд");
  assert.equal(commandsCount(21), "21 команда");
  assert.equal(commandsAccusative(1), "1 команду");
  assert.equal(commandsAccusative(3), "3 команды");
  assert.equal(commandsAccusative(12), "12 команд");
});

test("диалог утверждения: заголовок с устройством, текст с компанией", () => {
  const dialog = applyDialog({
    count: 3,
    device: "F1-VLD-GW01",
    company: "F1Lab",
  });
  assert.equal(dialog.title, "Применить 3 команды на F1-VLD-GW01?");
  assert.equal(
    dialog.body,
    "HD снимет резервную копию и выполнит команды на роутере компании F1Lab. Если команда не пройдёт или связь пропадёт, роутер откатит изменения сам.",
  );
  assert.equal(
    applyDialog({ count: 1, device: "R1" }).body.includes("компании"),
    false,
  );
  assert.equal(
    applyDialog({ count: 1, device: "R1" }).body,
    "HD снимет резервную копию и выполнит команды на роутере. Если команда не пройдёт или связь пропадёт, роутер откатит изменения сам.",
  );
});

test("результат команды: выполнена, откачена, не выполнялась, ответ роутера", () => {
  const cmd = (state, error, refused) => ({
    result: { state, error, refused },
  });
  assert.deepEqual(resultLine(cmd("done"), "applied"), {
    tone: "ok",
    text: "Выполнена",
  });
  assert.deepEqual(resultLine(cmd("rolled_back"), "rolled_back"), {
    tone: "idle",
    text: "Выполнена, затем откачена роутером",
  });
  assert.deepEqual(resultLine(cmd("skipped"), "rolled_back"), {
    tone: "idle",
    text: "Не выполнялась",
  });
  assert.deepEqual(
    resultLine(
      cmd("failed", "failure: already have such entry", true),
      "rolled_back",
    ),
    {
      tone: "bad",
      text: "Ответ роутера:",
      code: "failure: already have such entry",
    },
  );
  assert.deepEqual(resultLine(cmd("failed"), "not_applied"), {
    tone: "bad",
    text: "Не выполнилась",
  });
});

test("результат команды: у незавершённого и закрытого без применения запроса строки нет", () => {
  const done = { result: { state: "done" } };
  for (const s of [
    "awaiting_requester",
    "awaiting_responsible",
    "queued",
    "applying",
    "rejected",
    "expired",
    "cancelled",
  ]) {
    assert.equal(resultLine(done, s), null, s);
  }
  assert.equal(resultLine({}, "applied"), null);
  assert.deepEqual(
    resultLine({ result: { state: "pending" } }, "needs_attention"),
    {
      tone: "idle",
      text: "Результат не подтверждён",
    },
  );
});

test("причина риска по-русски; неизвестную не показываем сырой", () => {
  const reason = (r) => ({ riskReason: r });
  assert.equal(
    riskReasonText(
      reason("changes input firewall rules: may cut off the device"),
    ),
    "меняет правило цепочки input",
  );
  assert.equal(
    riskReasonText(reason("changes routes: may cut off the device")),
    "меняет маршруты",
  );
  assert.equal(
    riskReasonText(
      reason("changes or disables interfaces: may cut off the device"),
    ),
    "меняет или отключает интерфейсы",
  );
  assert.equal(
    riskReasonText(reason("something new: may cut off the device")),
    "затрагивает настройки связи с устройством",
  );
  assert.equal(
    riskReasonText(reason(null)),
    "затрагивает настройки связи с устройством",
  );
});

test("первая рискованная команда: номер и причина", () => {
  const commands = [
    { risk: "normal" },
    { risk: "high", riskReason: "changes routes: may cut off the device" },
    { risk: "high", riskReason: "changes NAT: may cut off the device" },
  ];
  assert.deepEqual(firstRisky(commands), {
    number: 2,
    reason: "меняет маршруты",
  });
  assert.equal(firstRisky([{ risk: "normal" }]), null);
  assert.equal(firstRisky(undefined), null);
});

test("состояние шага: сделан, отклонён, текущий, ждёт", () => {
  const steps = [
    { role: "requester", decision: "approve" },
    { role: "responsible", decision: null },
  ];
  assert.equal(stepState(steps, 0, "awaiting_responsible"), "done");
  assert.equal(stepState(steps, 1, "awaiting_responsible"), "current");
  assert.equal(
    stepState(
      [{ decision: null }, { decision: null }],
      1,
      "awaiting_requester",
    ),
    "pending",
  );
  assert.equal(
    stepState(
      [{ decision: null }, { decision: null }],
      0,
      "awaiting_requester",
    ),
    "current",
  );
  assert.equal(
    stepState([{ decision: "reject" }, { decision: null }], 0, "rejected"),
    "rejected",
  );
  // запрос закрыт — «текущего» шага нет
  assert.equal(
    stepState([{ decision: "approve" }, { decision: null }], 1, "expired"),
    "pending",
  );
});

test("подпись решённого шага: слово по роли, канал, время; без пола", () => {
  const two = (step) => decisionNote(step, 2, at());
  assert.equal(
    two({
      role: "requester",
      decision: "approve",
      channel: "telegram",
      decidedAt: "2026-10-10T08:41:00Z",
    }),
    "Подтверждено в Telegram, 11:41",
  );
  assert.equal(
    two({
      role: "responsible",
      decision: "approve",
      channel: "portal",
      decidedAt: "2026-10-10T08:51:00Z",
    }),
    "Утверждено на портале, 11:51",
  );
  assert.equal(
    two({
      role: "responsible",
      decision: "reject",
      channel: "portal",
      decidedAt: "2026-10-10T08:51:00Z",
    }),
    "Отклонено на портале, 11:51",
  );
  // единственный шаг заявителя — это утверждение
  assert.equal(
    decisionNote(
      {
        role: "requester",
        decision: "approve",
        channel: "portal",
        decidedAt: "2026-10-10T08:51:00Z",
      },
      1,
      at(),
    ),
    "Утверждено на портале, 11:51",
  );
  assert.equal(two({ role: "requester", decision: "approve" }), "Подтверждено");
});

test("подпись ожидающего шага", () => {
  const steps = [{ role: "requester" }, { role: "responsible" }];
  assert.equal(
    pendingNote(steps[0], "current"),
    "Подтверждает, что просил это изменение",
  );
  assert.equal(
    pendingNote(steps[1], "current"),
    "Утверждает применение на устройстве",
  );
  assert.equal(
    pendingNote(steps[1], "pending", "awaiting_requester"),
    "Получит запрос после подтверждения заявителя",
  );
  assert.equal(pendingNote(steps[1], "pending", "expired"), "Решения не было");
  assert.equal(
    pendingNote({ role: "requester" }, "current", "awaiting_requester", 1),
    "Утверждает применение на устройстве",
  );
});

test("итог раздела: сколько запросов и сколько ждёт решения", () => {
  const waiting = { status: "awaiting_responsible" };
  const done = { status: "applied" };
  assert.equal(
    listSummary([waiting, done, done, done]),
    "4 запроса, 1 ждёт решения",
  );
  assert.equal(
    listSummary([waiting, waiting, done]),
    "3 запроса, 2 ждут решения",
  );
  assert.equal(listSummary([done]), "1 запрос");
  assert.equal(listSummary([done, done, done, done, done]), "5 запросов");
  assert.equal(listSummary([]), "");
});

test("«никто не решил за N часов» по сроку запроса", () => {
  assert.equal(
    expiredAfter({
      createdAt: "2026-10-01T10:00:00Z",
      expiresAt: "2026-10-02T10:00:00Z",
    }),
    "Никто не решил за 24 часа",
  );
  assert.equal(
    expiredAfter({
      createdAt: "2026-10-01T10:00:00Z",
      expiresAt: "2026-10-01T11:00:00Z",
    }),
    "Никто не решил за 1 час",
  );
  assert.equal(
    expiredAfter({ createdAt: "2026-10-01T10:00:00Z" }),
    "Никто не решил",
  );
});

test("диалог утверждения при высоком риске: метка и первая рискованная команда впереди текста", () => {
  const risky = firstRisky([
    { risk: "normal" },
    {
      risk: "high",
      riskReason: "changes input firewall rules: may cut off the device",
    },
  ]);
  assert.equal(riskSentence(risky), "Команда 2 меняет правило цепочки input.");
  const dialog = applyDialog({
    count: 2,
    device: "R1",
    company: "F1Lab",
    risky,
  });
  assert.equal(
    dialog.body,
    "Может оборвать связь с устройством. Команда 2 меняет правило цепочки input. HD снимет резервную копию и выполнит команды на роутере компании F1Lab. Если команда не пройдёт или связь пропадёт, роутер откатит изменения сам.",
  );
  assert.equal(
    applyDialog({ count: 2, device: "R1", risky: null }).body.startsWith(
      "HD снимет",
    ),
    true,
  );
});

// --- финальная волна

test("диалог утверждения без автоматического отката (режим api): честный текст", () => {
  assert.equal(
    applyDialog({ count: 3, device: "GW", company: "F1Lab", rollback: false })
      .body,
    "HD снимет резервную копию и выполнит команды на роутере компании F1Lab. Автоматического отката нет: если команда не пройдёт, уже применённое останется.",
  );
  assert.equal(
    applyDialog({ count: 1, device: "R1", rollback: false }).body,
    "HD снимет резервную копию и выполнит команды на роутере. Автоматического отката нет: если команда не пройдёт, уже применённое останется.",
  );
  const risky = { number: 2, reason: "меняет правило цепочки input" };
  const body = applyDialog({
    count: 2,
    device: "R1",
    risky,
    rollback: false,
  }).body;
  assert.ok(body.startsWith("Может оборвать связь с устройством. Команда 2"));
  assert.ok(!body.includes("откатит"));
  // признака нет (старый сервер) или он true — прежний текст
  for (const rollback of [undefined, true]) {
    assert.ok(
      applyDialog({ count: 1, device: "R1", rollback }).body.endsWith(
        "роутер откатит изменения сам.",
      ),
    );
  }
});

test("подсказка под кнопками утверждения — по наличию отката", () => {
  assert.equal(
    approveHint(true),
    "Перед применением HD снимет резервную копию. При сбое роутер откатит изменения сам.",
  );
  assert.equal(approveHint(undefined), approveHint(true));
  assert.equal(
    approveHint(false),
    "Перед применением HD снимет резервную копию. Автоматического отката нет.",
  );
});

test("ошибка команды — «Ответ роутера» только при отказе роутера, иначе слова HD", () => {
  const cmd = (error, refused) => ({
    result: { state: "failed", error, refused },
  });
  assert.deepEqual(resultLine(cmd("no such item", true), "rolled_back"), {
    tone: "bad",
    text: "Ответ роутера:",
    code: "no such item",
  });
  for (const own of ["timed out", "not confirmed", "не найдена при проверке"]) {
    for (const refused of [false, undefined]) {
      assert.deepEqual(resultLine(cmd(own, refused), "needs_attention"), {
        tone: "bad",
        text: `Не подтверждена: ${own}`,
      });
    }
  }
});
