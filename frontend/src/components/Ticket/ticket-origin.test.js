// node --test src/components/Ticket/ticket-origin.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formDraftEnabled,
  originFormValues,
  originPayload,
} from "./ticket-origin.js";

const formData = {
  companies: [{ _id: "c1", alias: "ТД Восток" }],
  applicants: [{ _id: "u1", lastName: "Соколова", firstName: "Марина" }],
};

test("опознанный собеседник: компания и инициатор из черновика", () => {
  assert.deepEqual(
    originFormValues(
      { description: "<p>Принтер</p>", applicantId: "u1", companyId: "c1" },
      formData,
    ),
    {
      description: "<p>Принтер</p>",
      companyId: "c1",
      applicantId: "u1",
      applicantOptional: false,
    },
  );
});

test("неопознанный: инициатор необязателен, пустые поля не выдумываются", () => {
  assert.deepEqual(
    originFormValues(
      { description: "<p>Интернет</p>", applicantId: null, companyId: null },
      formData,
    ),
    {
      description: "<p>Интернет</p>",
      companyId: "",
      applicantId: "",
      applicantOptional: true,
    },
  );
});

test("чужие справочникам id не подставляются, но инициатор остаётся обязательным", () => {
  const values = originFormValues(
    { description: "", applicantId: "u-banned", companyId: "c-closed" },
    formData,
  );
  assert.equal(values.companyId, "");
  assert.equal(values.applicantId, "");
  assert.equal(values.applicantOptional, false);
  assert.equal(originFormValues(null, formData).description, "");
});

test("originPayload: id диалога и сообщения JSON-массивом", () => {
  assert.deepEqual(originPayload({ conversationId: "conv1", messageIds: ["m1", "m2"] }), {
    originConversationId: "conv1",
    originMessageIds: '["m1","m2"]',
  });
  assert.equal(originPayload({ conversationId: "conv1" }).originMessageIds, "[]");
});

test("у заявки из диалога нет локального черновика", () => {
  assert.equal(formDraftEnabled({ mode: "add", userId: "u1", origin: null }), true);
  assert.equal(
    formDraftEnabled({ mode: "add", userId: "u1", origin: { conversationId: "c1", messageIds: [] } }),
    false,
  );
  assert.equal(formDraftEnabled({ mode: "update", userId: "u1", origin: null }), false);
  assert.equal(formDraftEnabled({ mode: "add", userId: "", origin: null }), false);
});
