// node --test src/components/Preferences/modules-payload.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { MODULE_KEYS, modulesFromPrefs, modulesPayload } from "./modules-payload.js";

test("сохранение «Модулей» не выключает «Диалоги»: ключ уходит всегда", () => {
  const modules = modulesFromPrefs({
    messaging: { isActive: true },
    knowledgeBase: { isActive: true },
  });
  const { modules: body } = modulesPayload(modules);
  assert.deepEqual(Object.keys(body).sort(), [...MODULE_KEYS].sort());
  assert.equal(body.messaging.isActive, true);
  assert.equal(body.inventory.isActive, false);
});

test("отсутствующие в настройках модули читаются выключенными", () => {
  assert.deepEqual(modulesFromPrefs(undefined), {
    messaging: false,
    knowledgeBase: false,
    timeTracking: false,
    finances: false,
    inventory: false,
    mikrotik: false,
  });
});

test("финансы без учёта времени не включаются", () => {
  const { modules: body } = modulesPayload({ timeTracking: false, finances: true });
  assert.equal(body.finances.isActive, false);
  const { modules: on } = modulesPayload({ timeTracking: true, finances: true });
  assert.equal(on.finances.isActive, true);
});
