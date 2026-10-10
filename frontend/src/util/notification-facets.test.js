// node --test src/util/notification-facets.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_FACETS,
  facetByKey,
  facetCategories,
  readAllLabel,
  shownFacetKey,
  unreadInFacet,
  visibleFacets,
} from "./notification-facets.ts";

test("девять фасетов, «Все» первый, категории покрыты без дыр и дублей", () => {
  assert.equal(NOTIFICATION_FACETS.length, 9);
  assert.equal(NOTIFICATION_FACETS[0].key, "all");
  const covered = NOTIFICATION_FACETS.flatMap((facet) => facet.categories);
  assert.equal(new Set(covered).size, covered.length);
  assert.deepEqual([...covered].sort(), [
    "absenceDecision",
    "absenceRequest",
    "conversationMessage",
    "mikrotikChange",
    "newTicket",
    "reportApproval",
    "reportDecision",
    "respStateUpdate",
    "scheduledWorks",
    "ticketDeadlineUpdate",
    "ticketNewComment",
    "ticketStateUpdate",
  ]);
});

test("«Статусы» — и заявки, и ответственного", () => {
  assert.deepEqual(facetCategories("status"), [
    "ticketStateUpdate",
    "respStateUpdate",
  ]);
});

test("«Все» — фильтра нет; неизвестный ключ — тоже «Все»", () => {
  assert.equal(facetCategories("all"), null);
  assert.equal(facetByKey("nope").key, "all");
});

test("непрочитанное фасета складывается из его категорий", () => {
  const byCategory = {
    ticketStateUpdate: 2,
    respStateUpdate: 1,
    ticketNewComment: 4,
  };
  assert.equal(unreadInFacet(byCategory, "status"), 3);
  assert.equal(unreadInFacet(byCategory, "comment"), 4);
  assert.equal(unreadInFacet(byCategory, "deadline"), 0);
  assert.equal(unreadInFacet(byCategory, "all"), 7);
  assert.equal(unreadInFacet(undefined, "all"), 0);
});

test("кнопка говорит, что читает", () => {
  assert.equal(readAllLabel("all"), "Прочитать все");
  assert.equal(readAllLabel("comment"), "Прочитать комментарии");
  assert.equal(readAllLabel("new"), "Прочитать новые заявки");
});

test("«Диалоги» — сообщения, которые ждут ответа", () => {
  assert.deepEqual(facetCategories("dialogs"), ["conversationMessage"]);
  assert.equal(readAllLabel("dialogs"), "Прочитать диалоги");
});

test("фасет «Диалоги» — только тем, кому раздел открыт", () => {
  assert.equal(
    visibleFacets({ messaging: false }).some((facet) => facet.key === "dialogs"),
    false,
  );
  assert.equal(
    visibleFacets({ messaging: true }).some((facet) => facet.key === "dialogs"),
    true,
  );
  assert.equal(visibleFacets({ messaging: false }).length, NOTIFICATION_FACETS.length - 1);
});

test("«Запросы агентов» — категория mikrotikChange, видна при включённом Mikrotik", () => {
  assert.deepEqual(facetCategories("mikrotik"), ["mikrotikChange"]);
  assert.equal(
    visibleFacets({ messaging: true, mikrotik: false }).some((facet) => facet.key === "mikrotik"),
    false,
  );
  assert.equal(
    visibleFacets({ messaging: true, mikrotik: true }).some((facet) => facet.key === "mikrotik"),
    true,
  );
});

test("фасет, который скрыт, заменяется на «Все»", () => {
  const facets = visibleFacets({ messaging: true, mikrotik: false });
  assert.equal(shownFacetKey("mikrotik", facets), "all");
  assert.equal(shownFacetKey("comment", facets), "comment");
});
