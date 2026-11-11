import test from "node:test";
import assert from "node:assert/strict";
import { buildMenu } from "./menu.js";
import { makeCan } from "../../lib/access.ts";

test("global settings are a top-level navigation link with the route's access requirements", () => {
  for (const isEndUser of [false, true]) {
    for (const [statements, visible] of [
      [{ settings: ["manage"] }, true],
      [{ taxi: ["configure"] }, true],
      [{ taxi: ["read"] }, false],
      [{}, false],
    ]) {
      const menu = buildMenu({
        isEndUser,
        can: makeCan(statements),
        modules: {},
      });
      const settings = menu.filter((item) => item.to === "/preferences");
      assert.equal(settings.length, Number(visible));
      if (visible) assert.equal(settings[0].label, "Настройки системы");
    }
  }
});

const menuFor = (mikrotik, proxmox, rights = ["mikrotik", "proxmox"]) =>
  buildMenu({
    isEndUser: false,
    can: (query) => Object.keys(query).every((key) => rights.includes(key)),
    modules: {
      mikrotik: { isActive: mikrotik },
      proxmox: { isActive: proxmox },
    },
  });
const managementLinks = (menu) =>
  menu
    .find((item) => item.key === "management")
    ?.groups.flatMap((g) => g.items);

test("management groups MikroTik and Proxmox instead of separate navbar entries", () => {
  const menu = menuFor(true, true);
  assert.equal(
    menu.find((item) => item.key === "management")?.label,
    "Инфраструктура",
  );
  assert.deepEqual(
    managementLinks(menu)?.map(({ label, to }) => [label, to]),
    [
      ["MikroTik", "/devices/mikrotik"],
      ["Proxmox", "/devices/proxmox"],
    ],
  );
  assert.equal(
    menu.some((item) => ["monitoring", "proxmox"].includes(item.key)),
    false,
  );
});

for (const [mikrotik, proxmox, label] of [
  [true, false, "MikroTik"],
  [false, true, "Proxmox"],
]) {
  test(`management remains when only ${label} is enabled`, () => {
    assert.deepEqual(
      managementLinks(menuFor(mikrotik, proxmox))?.map((i) => i.label),
      [label],
    );
  });
}

test("module availability and read permissions independently filter management links", () => {
  assert.deepEqual(
    managementLinks(menuFor(true, true, ["proxmox"]))?.map((i) => i.label),
    ["Proxmox"],
  );
  assert.deepEqual(
    managementLinks(menuFor(true, true, ["mikrotik"]))?.map((i) => i.label),
    ["MikroTik"],
  );
  assert.equal(managementLinks(menuFor(false, false)), undefined);
  assert.equal(managementLinks(menuFor(true, true, [])), undefined);
});

test("taxi navigation requires a taxi permission and is absent for clients", () => {
  const staff = buildMenu({ isEndUser: false, can: () => false, modules: {} });
  const client = buildMenu({ isEndUser: true, can: () => true, modules: {} });
  const links = (menu) =>
    menu.flatMap(
      (item) => item.groups?.flatMap((group) => group.items) || [item],
    );
  assert.equal(
    links(staff).some((item) => item.key === "report-taxi"),
    false,
  );
  assert.equal(
    links(client).some((item) => item.key === "report-taxi"),
    false,
  );
  const full = buildMenu({
    isEndUser: false,
    can: () => true,
    modules: { finances: { isActive: true } },
  });
  assert.equal(
    links(full).find((item) => item.key === "fin-employees")?.to,
    "/finances/employees",
  );
  const reports = full
    .find((item) => item.key === "reports")
    .groups.flatMap((group) => group.items);
  assert.equal(reports.at(-1).key, "report-taxi");
  for (const action of ["read", "allocate", "configure"]) {
    const menu = buildMenu({
      isEndUser: false,
      modules: {},
      can: (request) => {
        const value = request.taxi;
        return Array.isArray(value)
          ? value.includes(action)
          : value?.actions.includes(action);
      },
    });
    assert.equal(
      links(menu).find((item) => item.key === "report-taxi")?.to,
      "/report/taxi",
    );
  }
});

test("retired taxi booking permissions cannot expose the report", () => {
  const links = (menu) =>
    menu.flatMap(
      (item) => item.groups?.flatMap((group) => group.items) || [item],
    );
  for (const action of ["order", "dispatch"]) {
    const menu = buildMenu({
      isEndUser: false,
      modules: {},
      can: (request) => {
        const value = request.taxi;
        return Array.isArray(value)
          ? value.includes(action)
          : value?.actions?.includes(action);
      },
    });
    assert.equal(
      links(menu).some((item) => item.key === "report-taxi"),
      false,
    );
  }
});

test("dialogue menu accepts readAll without read and rejects action-only roles", () => {
  for (const [actions, visible] of [
    [["readAll"], true],
    [["read"], true],
    [["reply", "start", "manage"], false],
  ]) {
    const menu = buildMenu({
      isEndUser: false,
      can: makeCan({ conversation: actions }),
      modules: { messaging: { isActive: true } },
    });
    assert.equal(
      menu.some((item) => item.to === "/conversations"),
      visible,
    );
  }
});

const allModules = Object.fromEntries(
  [
    "inventory",
    "finances",
    "timeTracking",
    "messaging",
    "knowledgeBase",
    "mikrotik",
    "proxmox",
  ].map((name) => [name, { isActive: true }]),
);
const menuLinks = (menu) =>
  menu.flatMap((item) =>
    item.groups ? item.groups.flatMap((group) => group.items) : [item],
  );

test("template readers have exactly one link to each destination, with or without ticket execution", () => {
  for (const perform of [false, true]) {
    const menu = buildMenu({
      isEndUser: false,
      can: makeCan({
        ticketTemplate: ["read"],
        ticket: perform ? ["perform"] : [],
      }),
      modules: allModules,
    });
    const destinations = menuLinks(menu).map((item) => item.to);
    assert.equal(
      destinations.filter((to) => to === "/ticket-templates").length,
      1,
    );
    assert.equal(new Set(destinations).size, destinations.length);
  }
});

test("single accessible entries are direct links and reports keep their context", () => {
  for (const [isEndUser, rights, to, label] of [
    [false, { role: ["read"] }, "/roles", "Роли"],
    [false, { report: ["own"] }, "/finances/my-report", "Мой отчёт"],
    [
      false,
      { report: ["employees"] },
      "/finances/employees",
      "Отчёт по сотрудникам",
    ],
    [false, { supplier: ["read"] }, "/inventory/suppliers", "Поставщики"],
    [
      false,
      { report: ["companies"] },
      "/report/companies",
      "Отчёт по компаниям",
    ],
    [
      true,
      { report: ["companies"] },
      "/report/companies",
      "Отчёт по компаниям",
    ],
    [false, { taxi: ["read"] }, "/report/taxi", "Отчёт по такси"],
  ]) {
    const menu = buildMenu({
      isEndUser,
      can: makeCan(rights),
      modules: allModules,
    });
    assert.equal(menu.find((item) => item.to === to)?.label, label);
    assert.equal(
      menu.some((item) => item.groups),
      false,
    );
  }
});

test("inventory groups device links without granting access to other catalogs", () => {
  const menu = buildMenu({
    isEndUser: false,
    can: makeCan({ device: ["read"], role: ["read"] }),
    modules: allModules,
  });
  const inventory = menu.find((item) => item.key === "inventory");
  assert.ok(inventory);
  assert.deepEqual(
    menuLinks([inventory]).map((item) => item.to),
    ["/inventory/client-devices", "/inventory/locations"],
  );
  assert.equal(menu.find((item) => item.to === "/roles")?.label, "Роли");
});

test("moving inventory catalogs preserves their module and individual permission gates", () => {
  const cases = [
    [
      { device: ["read"] },
      ["/inventory/client-devices", "/inventory/locations"],
    ],
    [
      { inventoryCatalog: ["read"] },
      [
        "/inventory/device-types",
        "/inventory/vendors",
        "/inventory/device-attributes",
        "/inventory/device-models",
      ],
    ],
    [{ supplier: ["read"] }, ["/inventory/suppliers"]],
    [{}, []],
  ];
  for (const [rights, expected] of cases) {
    for (const isActive of [true, false]) {
      const menu = buildMenu({
        isEndUser: false,
        can: makeCan(rights),
        modules: { inventory: { isActive } },
      });
      assert.deepEqual(
        menuLinks(menu)
          .filter((item) => item.to.startsWith("/inventory/"))
          .map((item) => item.to),
        isActive ? expected : [],
      );
    }
  }
});
