import test from "node:test";
import assert from "node:assert/strict";
import { guestAgentActionResult } from "./guest-agent-presentation.js";
test("failed settings requests retain their resource scope so the sheet can show the error", () => {
  assert.deepEqual(
    guestAgentActionResult(
      { error: true, message: "Нет права VM.Config.Options" },
      "vm1",
    ),
    {
      error: true,
      message: "Нет права VM.Config.Options",
      intent: "guestAgent",
      resourceId: "vm1",
    },
  );
});
import {
  guestAgentState,
  guestAgentLabel,
  guestAgentSettings,
  guestAgentNeedsRestart,
  guestAgentSaveSucceeded,
} from "./guest-agent-presentation.js";

test("agent silence never proves installation or absence", () => {
  assert.equal(
    guestAgentLabel({
      guestAgent: { state: "notResponding", installed: null },
    }),
    "Нет данных",
  );
  assert.equal(
    guestAgentLabel({
      guestAgent: { state: "notResponding", installed: true },
    }),
    "Установлен, не отвечает",
  );
  assert.equal(
    guestAgentLabel({ guestAgent: { state: "notInstalled", installed: null } }),
    "Нет данных",
  );
  assert.equal(
    guestAgentLabel({
      guestAgent: { state: "notInstalled", installed: false },
    }),
    "Не установлен",
  );
});

test("disabled and LXC states take precedence over stale runtime evidence", () => {
  assert.equal(
    guestAgentState({ guestAgent: { state: "responding", enabled: false } }),
    "disabled",
  );
  assert.equal(
    guestAgentState({ guestType: "lxc", guestAgent: { enabled: false } }),
    "notApplicable",
  );
  assert.equal(guestAgentLabel({}), "Нет данных");
});

test("opening enable preserves the configured channel and backup options", () => {
  const item = {
    guestAgent: {
      enabled: false,
      settings: {
        enabled: false,
        trimClonedDisks: true,
        freezeFilesystem: false,
        type: "isa",
      },
    },
  };
  assert.deepEqual(guestAgentSettings(item, true), {
    enabled: true,
    trimClonedDisks: true,
    freezeFilesystem: false,
    type: "isa",
  });
  assert.equal(item.guestAgent.settings.enabled, false);
  assert.equal(guestAgentSettings(item).enabled, false);
  assert.equal(
    guestAgentSettings({ guestAgent: { enabled: true } }).enabled,
    true,
  );
});

test("restart guidance appears only for an enabled agent on a running VM", () => {
  const item = {
    status: "running",
    guestAgent: {
      enabled: false,
      settings: { enabled: false, type: "virtio" },
    },
  };
  assert.equal(
    guestAgentNeedsRestart(item, guestAgentSettings(item, true)),
    true,
  );
  assert.equal(guestAgentNeedsRestart(item, guestAgentSettings(item)), false);
  assert.equal(
    guestAgentNeedsRestart(
      { ...item, status: "stopped" },
      guestAgentSettings(item, true),
    ),
    false,
  );
  assert.equal(
    guestAgentNeedsRestart(
      {
        status: "running",
        guestAgent: { settings: { enabled: true, type: "virtio" } },
      },
      { enabled: true, type: "isa" },
    ),
    true,
  );
});

test("saving another resource or receiving an error cannot close the editor", () => {
  assert.equal(
    guestAgentSaveSucceeded(
      { intent: "guestAgent", resourceId: "b", error: false },
      "a",
    ),
    false,
  );
  assert.equal(
    guestAgentSaveSucceeded(
      { intent: "guestAgent", resourceId: "a", error: true },
      "a",
    ),
    false,
  );
  assert.equal(
    guestAgentSaveSucceeded(
      { intent: "monitoring", resourceId: "a", error: false },
      "a",
    ),
    false,
  );
  assert.equal(
    guestAgentSaveSucceeded(
      { intent: "guestAgent", resourceId: "a", error: false },
      "a",
    ),
    true,
  );
  assert.equal(guestAgentSaveSucceeded(null, "a"), false);
});
