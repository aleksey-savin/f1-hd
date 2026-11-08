import test from "node:test";
import assert from "node:assert/strict";
import { buildMenu } from "./menu.js";

const menuFor = (mikrotik, proxmox, rights = ["mikrotik", "proxmox"]) =>
  buildMenu({
    isEndUser: false,
    can: (query) => Object.keys(query).every((key) => rights.includes(key)),
    modules: { mikrotik: { isActive: mikrotik }, proxmox: { isActive: proxmox } },
  });
const managementLinks = (menu) =>
  menu.find((item) => item.key === "management")?.groups.flatMap((g) => g.items);

test("management groups MikroTik and Proxmox instead of separate navbar entries", () => {
  const menu = menuFor(true, true);
  assert.equal(menu.find((item) => item.key === "management")?.label, "Управление");
  assert.deepEqual(managementLinks(menu)?.map(({ label, to }) => [label, to]), [
    ["MikroTik", "/devices/mikrotik"],
    ["Proxmox", "/devices/proxmox"],
  ]);
  assert.equal(menu.some((item) => ["monitoring", "proxmox"].includes(item.key)), false);
});

for (const [mikrotik, proxmox, label] of [
  [true, false, "MikroTik"],
  [false, true, "Proxmox"],
]) {
  test(`management remains when only ${label} is enabled`, () => {
    assert.deepEqual(managementLinks(menuFor(mikrotik, proxmox))?.map((i) => i.label), [label]);
  });
}

test("module availability and read permissions independently filter management links", () => {
  assert.deepEqual(managementLinks(menuFor(true, true, ["proxmox"]))?.map((i) => i.label), ["Proxmox"]);
  assert.deepEqual(managementLinks(menuFor(true, true, ["mikrotik"]))?.map((i) => i.label), ["MikroTik"]);
  assert.equal(managementLinks(menuFor(false, false)), undefined);
  assert.equal(managementLinks(menuFor(true, true, [])), undefined);
});
