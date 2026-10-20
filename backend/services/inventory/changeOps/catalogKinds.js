// Каталожные операции пакета: справочники техники (seed-формат), вендор,
// поставщик, модель, конфигурация, сборка. Проверки и тексты — catalogOps
// (Task 3); здесь имена полей агента и текст для случая со ссылкой на ещё не
// созданное.
const { field, entity, asIdMap, defineKind } = require("./kit");

const CATALOG_RIGHT = { inventoryCatalog: ["manage"] };

const options = (ctx) => ({ userId: ctx.userId });
const nameOf = (params) => (typeof params?.name === "string" ? params.name.trim() : "");
const createdAs = (refKind) => (result) => ({ created: { [refKind]: String(result.id) } });

// Пара сервиса create*/check* с аргументами (args, { userId })
const pair = (ops, check, apply) => ({
  check: (args, ctx) => ops[check](args, options(ctx)),
  apply: (args, ctx) => ops[apply](args, options(ctx)),
});

// Запись каталога по его key в списке типов или атрибутов
const catalogEntry = (params, refKind, key) => {
  const list = params?.[refKind === "type" ? "types" : "attributes"];
  return Array.isArray(list) ? list.find((item) => item?.key === key) : undefined;
};

module.exports = (deps) => {
  const ops = deps.catalogOps;

  const catalog = defineKind(
    {
      right: CATALOG_RIGHT,
      refKinds: ["type", "attribute"],
      fields: ["groups", "types", "attributes"].map((name) => field(name, { type: "array" })),
      label: (params, key, refKind) => catalogEntry(params, refKind, key)?.name ?? key,
      // «Каталог не меняется» — отказ только при предложении: к применению всё
      // могло уже появиться, тогда операция отдаёт подхваченные id для ссылок
      service: {
        check: (args, ctx) => ops.checkCatalogPatch(args, { allowNoop: Boolean(ctx.applying) }),
        apply: (args, ctx) => ops.applyCatalogPatch(args, options(ctx)),
      },
      created: (result) => ({
        // group — только для «Создано» на портале: ссылок на группы в пакете нет
        created: { type: asIdMap(result.ids?.types), attribute: asIdMap(result.ids?.attributes), group: asIdMap(result.ids?.groups) },
        catalogIds: result.ids,
      }),
      // Заголовок и по строке на изменение: в Telegram это подстроки операции
      text: ({ checked }) => ["Справочники техники:", ...(checked.lines ?? [checked.text])],
    },
    deps,
  );

  const createVendor = defineKind(
    {
      right: CATALOG_RIGHT,
      refKinds: ["vendor"],
      fields: [field("name", { required: true })],
      label: nameOf,
      service: pair(ops, "checkVendor", "createVendor"),
      created: createdAs("vendor"),
      text: ({ checked }) => checked.text,
    },
    deps,
  );

  const createSupplier = defineKind(
    {
      right: { supplier: ["manage"] },
      refKinds: ["supplier"],
      fields: ["name", "inn", "kpp", "website", "notes"].map((name) => field(name, { required: name === "name" })),
      label: nameOf,
      service: pair(ops, "checkSupplier", "createSupplier"),
      created: createdAs("supplier"),
      text: ({ checked }) => checked.text,
    },
    deps,
  );

  const createModel = defineKind(
    {
      right: CATALOG_RIGHT,
      refKinds: ["model"],
      fields: [
        entity("type", "type", { to: "deviceTypeId", required: true }),
        entity("vendor", "vendor", { to: "vendorId", required: true }),
        field("name", { required: true }),
        field("notes"),
      ],
      label: nameOf,
      service: pair(ops, "checkModel", "createModel"),
      created: createdAs("model"),
      text: ({ checked, params, show }) =>
        checked ? checked.text : `Новая модель «${nameOf(params)}»: тип ${show("type")}, вендор ${show("vendor")}`,
    },
    deps,
  );

  // Значения конфигурации по именам атрибутов: из каталогов пакета, затем из
  // справочника; не нашлось — код как есть (проверит применение).
  const valuesText = async (values, ctx) => {
    const codes = values.map((item) => String(item.attribute));
    const names = new Map();
    for (const entry of ctx.pending?.values() ?? []) {
      if (entry.kind !== "catalog" || !Array.isArray(entry.params?.attributes)) continue;
      for (const attr of entry.params.attributes) if (attr?.code) names.set(attr.code, attr.name);
    }
    const missing = codes.filter((code) => !names.has(code));
    if (missing.length && deps.attributeNames) {
      for (const [code, name] of Object.entries(await deps.attributeNames(missing))) names.set(code, name);
    }
    return values.map((item, i) => {
      const value = Array.isArray(item.value) ? item.value.join(", ") : String(item.value ?? "");
      return `${names.get(codes[i]) ?? codes[i]} ${value}`.trim();
    });
  };

  const createConfiguration = defineKind(
    {
      right: CATALOG_RIGHT,
      refKinds: ["configuration"],
      fields: [
        entity("model", "model", { to: "deviceModelId", required: true }),
        field("name", { required: true }),
        field("description"),
        field("values", { list: [field("attribute", { required: true }), field("value", { type: "value" })] }),
      ],
      label: nameOf,
      service: pair(ops, "checkConfiguration", "createConfiguration"),
      created: createdAs("configuration"),
      text: async ({ checked, params, show, ctx }) => {
        if (checked) return checked.text;
        const shown = await valuesText(params.values ?? [], ctx);
        return `Новая конфигурация «${nameOf(params)}» для ${show("model")}` + (shown.length ? `: ${shown.join(", ")}` : "");
      },
    },
    deps,
  );

  const createBuild = defineKind(
    {
      right: CATALOG_RIGHT,
      refKinds: ["build"],
      fields: [
        entity("type", "type", { to: "deviceTypeId", required: true }),
        field("name", { required: true }),
        field("parts", {
          list: [
            entity("type", "type", { to: "typeId", required: true }),
            entity("model", "model", { to: "deviceModelId", required: true }),
            entity("configuration", "configuration", { to: "configurationId" }),
            field("quantity", { type: "number" }),
          ],
        }),
        field("notes"),
      ],
      label: nameOf,
      service: pair(ops, "checkBuild", "createBuild"),
      created: createdAs("build"),
      text: ({ checked, params, show }) => {
        if (checked) return checked.text;
        const parts = (params.parts ?? []).map((part, i) => {
          const model = show(`parts[${i}].model`);
          return Number(part.quantity) > 1 ? `${model} ×${part.quantity}` : model;
        });
        return `Новая сборка «${nameOf(params)}» (${show("type")})` + (parts.length ? `: ${parts.join(", ")}` : "");
      },
    },
    deps,
  );

  return { catalog, createVendor, createSupplier, createModel, createConfiguration, createBuild };
};

module.exports.catalogEntry = catalogEntry;
