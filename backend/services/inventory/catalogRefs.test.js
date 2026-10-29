const test = require("node:test");
const assert = require("node:assert/strict");
const { REF_TABLE, createCatalogRefs, countLines } = require("./catalogRefs");

// Фейковый хранилище: ответы по "Model:path"
const fakeStore = (answers) => ({
  query: async (model, path) => answers[`${model}:${path}`] || [],
});

test("find: модель — устройства, конфигурации, сборки, совместимость, с удалёнными отдельно", async () => {
  const store = fakeStore({
    "ClientDevice:deviceModelId": [
      { _id: "d2" },
      { _id: "d1" },
      { _id: "d3", deletedAt: new Date() },
    ],
    "DeviceConfiguration:deviceModelId": [{ _id: "c1" }],
    "DeviceBuild:parts.deviceModelId": [{ _id: "b1" }],
    "DeviceModel:compatibleWithModelIds": [{ _id: "m1" }],
  });
  const refs = await createCatalogRefs({ store }).find("DeviceModel", "m0");
  assert.deepEqual(
    refs.map((r) => r.model + ":" + r.path),
    [
      "ClientDevice:deviceModelId",
      "DeviceConfiguration:deviceModelId",
      "DeviceBuild:parts.deviceModelId",
      "DeviceModel:compatibleWithModelIds",
    ],
  );
  const devices = refs[0];
  assert.equal(devices.live, 2);
  assert.equal(devices.deleted, 1);
  assert.deepEqual(devices.ids, ["d1", "d2", "d3"]);
  assert.equal(refs[1].live, 1);
});

test("same: появилось новое — diff «на модель «X» появилось 1 новое устройство»", () => {
  const refs = createCatalogRefs({ store: fakeStore({}) });
  const entry = (ids) => [
    { model: "ClientDevice", path: "deviceModelId", ids, live: ids.length, deleted: 0, deletedIds: [] },
  ];
  const res = refs.same(entry(["d1"]), entry(["d1", "d2"]), { entityLabel: "модель", name: "X" });
  assert.equal(res.ok, false);
  assert.deepEqual(res.diff, ["на модель «X» появилось 1 новое устройство"]);
  assert.equal(refs.same(entry(["d1"]), entry(["d1"])).ok, true);
});

test("same: исчезло — дрейф", () => {
  const refs = createCatalogRefs({ store: fakeStore({}) });
  const entry = (ids) => ids.length
    ? [{ model: "ClientDevice", path: "deviceModelId", ids, live: ids.length, deleted: 0, deletedIds: [] }]
    : [];
  const res = refs.same(entry(["d1", "d2"]), entry([]), { entityLabel: "модель", name: "X" });
  assert.equal(res.ok, false);
  assert.deepEqual(res.diff, ["на модель «X» стало меньше: 2 устройства"]);
});

test("countLines: «устройств: 12 и 1 удалённое»", () => {
  const ids = Array.from({ length: 13 }, (_, i) => `d${i}`);
  const lines = countLines([
    { model: "ClientDevice", path: "deviceModelId", ids, live: 12, deleted: 1, deletedIds: ["d12"] },
    { model: "DeviceConfiguration", path: "deviceModelId", ids: ["c1", "c2"], live: 2, deleted: 0, deletedIds: [] },
  ]);
  assert.deepEqual(lines, ["устройств: 12 и 1 удалённое", "конфигураций: 2"]);
  assert.match(
    countLines([{ model: "ClientDevice", path: "deviceModelId", ids: ["a", "b", "c"], live: 1, deleted: 2, deletedIds: ["b", "c"] }])[0],
    /^устройств: 1 и 2 удалённых$/,
  );
});

test("REF_TABLE без мёртвых полей", () => {
  const all = Object.values(REF_TABLE).flat();
  const key = (r) => `${r.model}.${r.path}`;
  const keys = all.map(key);
  assert.ok(!keys.includes("DeviceType.configurationIds"));
  assert.ok(!keys.includes("DeviceTypeAttribute.extendableFromIds"));
  assert.ok(!all.some((r) => r.model === "DeviceConfigurationRecommendation"));
  assert.deepEqual(Object.keys(REF_TABLE).sort(), [
    "AttributeGroup", "DeviceAttribute", "DeviceConfiguration", "DeviceModel", "DeviceType", "Supplier", "Vendor",
  ]);
  assert.ok(Object.isFrozen(REF_TABLE) && Object.isFrozen(REF_TABLE.DeviceModel));
});

test("same: формы числа — 2 новых устройства, 5 новых устройств", () => {
  const refs = createCatalogRefs({ store: fakeStore({}) });
  const entry = (ids) => [
    { model: "ClientDevice", path: "deviceModelId", ids, live: ids.length, deleted: 0, deletedIds: [] },
  ];
  const opts = { entityLabel: "модель", name: "X" };
  assert.deepEqual(refs.same(entry([]), entry(["a", "b"]), opts).diff, ["на модель «X» появилось 2 новых устройства"]);
  assert.deepEqual(refs.same(entry([]), entry(["a", "b", "c", "d", "e"]), opts).diff, ["на модель «X» появилось 5 новых устройств"]);
});

test("find: путь-массив ищется по тому же пути, совместимость — отдельная строка счётчика", async () => {
  const calls = [];
  const store = {
    query: async (model, path, kind, id) => {
      calls.push([model, path, kind, id]);
      return model === "DeviceModel" ? [{ _id: "m1" }, { _id: "m2" }] : [];
    },
  };
  const refs = await createCatalogRefs({ store }).find("DeviceModel", "m0");
  assert.deepEqual(calls[3], ["DeviceModel", "compatibleWithModelIds", "array", "m0"]);
  assert.deepEqual(countLines(refs), ["совместимость: у 2 моделей"]);
});

test("find: у моделей без deletedAt все попадания живые", async () => {
  const store = fakeStore({ "DeviceTypeAttribute:groupId": [{ _id: "l1", deletedAt: new Date() }] });
  const refs = await createCatalogRefs({ store }).find("AttributeGroup", "g1");
  assert.equal(refs[0].live, 1);
  assert.equal(refs[0].deleted, 0);
});

test("countLines: «и 1 удалённое» в единственном числе", () => {
  assert.deepEqual(
    countLines([{ model: "DeviceBuild", path: "parts.deviceModelId", ids: ["b"], live: 0, deleted: 1, deletedIds: ["b"] }]),
    ["сборок: 0 и 1 удалённое"],
  );
});

test("same: глагол по роду — «появилась 1 новая конфигурация»", () => {
  const refs = createCatalogRefs({ store: fakeStore({}) });
  const entry = (ids) => [
    { model: "DeviceConfiguration", path: "deviceModelId", ids, live: ids.length, deleted: 0, deletedIds: [] },
  ];
  const res = refs.same(entry([]), entry(["c1"]), { entityLabel: "модель", name: "X" });
  assert.deepEqual(res.diff, ["на модель «X» появилась 1 новая конфигурация"]);
  const two = refs.same(entry([]), entry(["c1", "c2"]), { entityLabel: "модель", name: "X" });
  assert.match(two.diff[0], /^на модель «X» появилось 2 новых конфигурации$/);
});
