import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLayout,
  reconcileLayout,
  visibleWidgets,
  moveWidget,
  stepWidget,
  toggleWidget,
  groupWidgets,
  dataRequirements,
  availableWidgets,
  widgetGroupKey,
} from "./layout.ts";
import { makeCan } from "../../lib/access.ts";

test("a new widget appears without losing saved order, disabled state or temporarily unavailable choices", () => {
  const layout = reconcileLayout(
    {
      customOrder: true,
      widgets: [
        { id: "report", zone: "main", visible: false },
        { id: "tickets", zone: "aside", visible: true },
        { id: "deletedWidget", zone: "top", visible: true },
      ],
    },
    "staff",
  );
  assert.deepEqual(layout.widgets.slice(0, 2), [
    { id: "report", zone: "main", visible: false },
    { id: "tickets", zone: "aside", visible: true },
  ]);
  assert.equal(
    layout.widgets.some((widget) => widget.id === "deletedWidget"),
    false,
  );
  assert.deepEqual(
    layout.widgets.find((widget) => widget.id === "monitoring"),
    { id: "monitoring", zone: "main", visible: true },
  );
  const available = new Set(["tickets", "templates"]);
  assert.deepEqual(
    visibleWidgets(layout, available, false).map((widget) => widget.id),
    ["tickets", "templates"],
  );
  assert.equal(
    layout.widgets.find((widget) => widget.id === "report").visible,
    false,
  );
});

test("default mobile ordering respects the agreed landing page; manual order overrides only ordering", () => {
  const layout = defaultLayout("staff");
  const available = new Set(layout.widgets.map((widget) => widget.id));
  assert.deepEqual(
    visibleWidgets(layout, available, false)
      .filter((w) => w.zone === "main")
      .map((w) => w.id),
    [
      "agentChanges",
      "templates",
      "userReview",
      "tickets",
      "expiry",
      "knowledge",
      "monitoring",
    ],
  );
  const mobile = visibleWidgets(layout, available, true).map((w) => w.id);
  assert.equal(mobile[0], "team");
  assert.ok(mobile.indexOf("tickets") < mobile.indexOf("templates"));
  assert.equal(
    visibleWidgets(layout, available, false).some((w) => w.id === "team"),
    false,
  );
  const moved = moveWidget(layout, "templates", "top", "today");
  assert.equal(moved.customOrder, true);
  assert.deepEqual(
    visibleWidgets(moved, available, true)
      .filter((w) => w.zone === "top")
      .map((w) => w.id),
    ["team", "templates", "today"],
  );
});

test("moving within and between regions preserves every widget and does not mutate the original", () => {
  const layout = {
    customOrder: true,
    widgets: [
      { id: "tickets", zone: "main", visible: true },
      { id: "expiry", zone: "main", visible: false },
      { id: "report", zone: "aside", visible: true },
      { id: "upcoming", zone: "aside", visible: true },
    ],
  };
  const moved = moveWidget(layout, "tickets", "aside", "upcoming");
  assert.deepEqual(
    moved.widgets.filter((w) => w.zone === "aside").map((w) => w.id),
    ["report", "tickets", "upcoming"],
  );
  assert.equal(layout.widgets[0].zone, "main");
  assert.equal(moved.widgets.length, 4);
  const stepped = stepWidget(
    moved,
    "tickets",
    -1,
    new Set(["tickets", "report", "upcoming"]),
    false,
  );
  assert.deepEqual(
    stepped.widgets.filter((w) => w.zone === "aside").map((w) => w.id),
    ["tickets", "report", "upcoming"],
  );
  assert.deepEqual(
    stepWidget(
      stepped,
      "tickets",
      -1,
      new Set(["tickets", "report", "upcoming"]),
      false,
    ),
    stepped,
  );
  assert.equal(
    toggleWidget(moved, "expiry").widgets.find((w) => w.id === "expiry")
      .visible,
    true,
  );
});

test("keyboard movement follows what is visible on mobile and skips unavailable or disabled widgets", () => {
  const layout = defaultLayout("staff");
  const available = new Set(["templates", "tickets", "expiry"]);
  const moved = stepWidget(layout, "tickets", 1, available, true);
  assert.deepEqual(
    visibleWidgets(moved, available, true).map((w) => w.id),
    ["templates", "tickets", "expiry"],
  );
  const hidden = toggleWidget(moved, "templates");
  assert.deepEqual(
    visibleWidgets(
      stepWidget(hidden, "tickets", 1, available, true),
      available,
      true,
    ).map((w) => w.id),
    ["expiry", "tickets"],
  );
});

test("only adjacent attention widgets share a grid and other widgets retain their position", () => {
  const widgets = [
    "tickets",
    "expiry",
    "knowledge",
    "report",
    "monitoring",
  ].map((id) => ({ id, zone: "main", visible: true }));
  assert.deepEqual(
    groupWidgets(widgets).map((group) => group.map((w) => w.id)),
    [["tickets"], ["expiry", "knowledge"], ["report"], ["monitoring"]],
  );
});

test("reordering compact widgets preserves their group identity so React retains keyboard focus", () => {
  const layout = defaultLayout("staff");
  const available = new Set(["expiry", "knowledge", "monitoring"]);
  const before = groupWidgets(visibleWidgets(layout, available, false))[0];
  const moved = stepWidget(layout, "expiry", 1, available, false);
  const after = groupWidgets(visibleWidgets(moved, available, false))[0];
  assert.deepEqual(
    after.map((widget) => widget.id),
    ["knowledge", "expiry", "monitoring"],
  );
  assert.equal(widgetGroupKey(before), widgetGroupKey(after));
  assert.notEqual(widgetGroupKey(after.slice(0, 2)), widgetGroupKey(before));
});

test("disabled shared consumers stop their requests without preventing the remaining consumer from loading", () => {
  const layout = defaultLayout("staff");
  const available = new Set(layout.widgets.map((w) => w.id));
  assert.deepEqual(dataRequirements(layout, available), {
    tickets: true,
    templates: true,
    plan: true,
  });
  const onlyUpcoming = ["tickets", "templates", "today"].reduce(
    toggleWidget,
    layout,
  );
  assert.deepEqual(dataRequirements(onlyUpcoming, available), {
    tickets: false,
    templates: false,
    plan: true,
  });
  assert.deepEqual(
    dataRequirements(toggleWidget(onlyUpcoming, "upcoming"), available),
    { tickets: false, templates: false, plan: false },
  );
  assert.deepEqual(dataRequirements(layout, new Set()), {
    tickets: false,
    templates: false,
    plan: false,
  });
});

test("client composition never imports staff settings and defaults remain independent", () => {
  const first = defaultLayout("client");
  first.widgets[0].visible = false;
  assert.equal(defaultLayout("client").widgets[0].visible, true);
  const client = reconcileLayout(
    {
      customOrder: true,
      widgets: [{ id: "report", zone: "main", visible: true }],
    },
    "client",
  );
  assert.deepEqual(
    client.widgets.map((w) => w.id),
    ["templates", "tickets", "workplace", "support", "expiry"],
  );
});

test("widget controls respect module and permission gates while own workplace needs no inventory permission", () => {
  const modules = {
    inventory: { isActive: true },
    finances: { isActive: true },
    timeTracking: { isActive: true },
    mikrotik: { isActive: true },
  };
  const none = makeCan({});
  const staff = availableWidgets({ audience: "staff", modules, can: none });
  assert.equal(staff.has("report"), false);
  assert.equal(staff.has("monitoring"), false);
  assert.equal(staff.has("today"), false);
  assert.equal(staff.has("templates"), false);
  assert.equal(staff.has("userReview"), false);
  const all = availableWidgets({
    audience: "staff",
    modules,
    can: makeCan({
      work: ["read"],
      report: ["own"],
      mikrotik: ["read"],
      knowledge: ["moderate"],
      ticket: ["createForOthers"],
      userReview: ["read"],
    }),
  });
  for (const id of [
    "report",
    "monitoring",
    "today",
    "upcoming",
    "templates",
    "knowledge",
    "userReview",
  ])
    assert.equal(all.has(id), true, id);
  assert.equal(
    availableWidgets({
      audience: "staff",
      modules: {},
      can: makeCan({ report: ["own"] }),
    }).has("report"),
    false,
  );
  const client = availableWidgets({ audience: "client", modules, can: none });
  assert.equal(client.has("workplace"), true);
  assert.equal(client.has("report"), false);
  assert.equal(
    availableWidgets({
      audience: "client",
      modules,
      can: makeCan({ userReview: ["read"] }),
    }).has("userReview"),
    false,
  );
  assert.equal(client.has("support"), true);
  assert.equal(
    availableWidgets({
      audience: "staff",
      modules,
      can: none,
      hideWorkStatus: true,
    }).has("team"),
    false,
  );
});
