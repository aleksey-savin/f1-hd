// Правка записей каталога: вендор, поставщик, модель, тип, группа, атрибут,
// связь тип↔атрибут, конфигурация, шаблон сборки. Проверки, отказы и запись —
// catalogEditOps; здесь имена полей агента, подписи и текст
// «Изменить <вид> «A»: <поле> → «значение», …» (страница — таблица «было → стало»).
// Цель правки — только существующая запись (ссылка на операцию пакета не
// принимается). У вендора, поставщика, типа и атрибута цель может быть скрытой:
// так её возвращают (isActive:true). Модель, группа, конфигурация и сборка
// скрытыми не бывают: удалённая отказывает. У связи тип↔атрибут скрытыми
// могут быть и тип, и атрибут.
// Связь тип↔атрибут задают type и attribute (id); attribute в значениях
// конфигурации — код атрибута, как у createConfiguration.
// Только скрытие (isActive:false — единственное поле) у вендора, поставщика, типа
// и атрибута — «Скрыть <вид> «A»», без «(не используется)»: использование
// проверяет только retire*.
// updateAttribute с renameOptions переписывает конфигурации по снимку: его
// mentions (id и код атрибута) включают правило пакета changeOps — другая
// операция, назвавшая атрибут (значение по коду, связь), — «отдельным пакетом».
const { field, entity, defineKind, blank } = require("./kit");
const { partsText } = require("./catalogKinds");
const { plural } = require("../catalogRefs");

const CATALOG_RIGHT = { inventoryCatalog: ["manage"] };
const DRIFT = "изменилось после предложения";
const SUPPLIER_RIGHT = { supplier: ["manage"] };

const LABELS = {
  name: "название",
  isActive: "активен",
  website: "сайт",
  inn: "ИНН",
  kpp: "КПП",
  notes: "заметки",
  vendorId: "вендор",
  compatibleWithModelIds: "совместимые модели",
  isComponent: "комплектующее",
  isConsumable: "расходник",
  isPeripheral: "периферия",
  inventoryPrefix: "префикс номеров",
  attachableToTypeIds: "прикрепляется к типам",
  order: "порядок",
  unit: "единица измерения",
  required: "обязательный",
  groupId: "группа",
  description: "описание",
  parts: "детали",
};

// Цель правки: существующая запись, без ссылки на операцию пакета
const target = (kind, opts, name = "id") => {
  const f = entity(name, kind, { required: true, ...opts });
  return { ...f, entity: { ...f.entity, refKind: null } };
};

const text = (name) => field(name, { nullable: true });
const bool = (name) => field(name, { type: "boolean" });

// Значения «стало» простым текстом: список — именами, булево — да/нет
const cleared = (value) => value === null || value === "" || (Array.isArray(value) && value.length === 0);
const quoted = (name) => `«${name}»`;
// «в 7 конфигурациях», «в 1 конфигурации и 2 удалённых»
const inConfigs = ({ live = 0, deleted = 0 }) => {
  if (!live && !deleted) return "ни в одной конфигурации";
  const head = `в ${live} ${plural(live, "конфигурации", "конфигурациях", "конфигурациях")}`;
  return deleted ? `${head} и ${deleted} ${plural(deleted, "удалённой", "удалённых", "удалённых")}` : head;
};
const isStrings = (value) => value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));

// Строки полей, которые считает сервис (не «поле → значение»): [{ label, value, before?, text }]
const ROWS = {
  addOptions: (t) => {
    const added = t.checked?.added ?? t.params.addOptions ?? [];
    if (!added.length) return [];
    return [{ label: "новые варианты", value: added.join(", "), text: `новые варианты: ${added.join(", ")}` }];
  },
  renameOptions: (t) =>
    (t.checked?.renames ?? []).map((r) => ({
      label: "переименовать вариант",
      value: `${quoted(r.from)} → ${quoted(r.to)} · ${inConfigs(r)}`,
      text: `вариант ${quoted(r.from)} → ${quoted(r.to)} (${inConfigs(r)})`,
    })),
};
const valueRows = (field) => (t) =>
  (t.checked?.values ?? [])
    .filter((row) => row.field === field)
    .map((row) => ({
      label: row.name,
      value: row.value ?? "очистить",
      before: row.before,
      text: row.value === null ? `${row.name} — очистить` : `${row.name} → ${quoted(row.value)}`,
    }));
ROWS.setValues = valueRows("setValues");
ROWS.clearValues = valueRows("clearValues");

module.exports = (deps) => {
  const ops = () => deps.catalogEditOps;
  const nameOf = (t) => `«${t.view.id.name}»`;

  const listNames = async (model, list) => {
    const names = [];
    for (const id of list) names.push((await deps.describe(model, id))?.name);
    return names.filter(Boolean).join(", ");
  };

  // Вид правки: spec — { word, right, target, fields, svc, lists, hide, collapse,
  //   keys (параметры цели), title(t) (что правим, без глагола), check (доп.
  //   причины формы), display (своё «стало» поля), snapshot (передать снимок refs),
  //   mentions (правило пакета, см. шапку) }
  const edit = ({
    word,
    right,
    target: id,
    fields,
    svc,
    lists = {},
    hide = false,
    collapse = false,
    keys = [id.name],
    targets = [id],
    title = (t) => `${word} ${nameOf(t)}`,
    check: extraCheck = () => [],
    display = {},
    snapshot = false,
    mentions,
  }) => {
    const order = fields.map((f) => f.name);
    // Поля правки; когда проверка отдала «было», — только те, что меняются
    // (неизменное поле, которое агент повторил, в тексте не показываем).
    // Поля-строки сервиса (ROWS) показываются своими строками
    const changed = (t) => {
      const before = t.checked?.before;
      const only = before && Object.keys(before).length ? before : null;
      return order.filter((name) => Object.hasOwn(t.params, name) && (ROWS[name] || !only || Object.hasOwn(only, name)));
    };

    const plain = async (t, name) => {
      const value = t.params[name];
      if (cleared(value)) return "очистить";
      if (display[name]) return display[name](t);
      if (t.view[name]) return `${t.view[name].name}${t.view[name].pending ? " (будет создано выше)" : ""}`;
      if (typeof value === "boolean") return value ? "да" : "нет";
      if (lists[name]) return listNames(lists[name], value);
      // Как будет записано: обрезка, префикс заглавными, у группы — один пробел
      let shown = String(value).trim();
      if (collapse) shown = shown.replace(/\s+/g, " ");
      return name === "inventoryPrefix" ? shown.toUpperCase() : shown;
    };
    // Только скрытие: «Скрыть тип «A»» (использование здесь не проверялось)
    const hiding = (t) => hide && t.params.isActive === false && changed(t).length === 1;

    // Снимок refs (renameOptions) — только видам, которым он нужен
    const withSnapshot = (ctx) => (snapshot ? { snapshot: ctx.applying ? (ctx.snapshot ?? null) : undefined } : {});
    // Сверка снимка до записи пакета — та же проверка, что при применении; прочие отказы — не дрейф
    const drift = async (args, snap) => {
      const checked = await ops()[`check${svc}`](args, { allowNoop: true, snapshot: snap ?? null });
      return !checked.ok && String(checked.message ?? "").startsWith(DRIFT) ? checked.message : null;
    };

    return defineKind(
      {
        right,
        refKinds: [],
        fields: [...targets, ...fields],
        validate: (params) => {
          if (!Object.keys(params).some((key) => !keys.includes(key))) return ["нет полей для изменения"];
          return extraCheck(params);
        },
        ...(snapshot ? { drift } : {}),
        ...(mentions ? { mentions } : {}),
        service: {
          check: (args, ctx) => ops()[`check${svc}`](args, { allowNoop: Boolean(ctx.applying), ...withSnapshot(ctx) }),
          apply: (args, ctx) =>
            ops()[`apply${svc}`](args, {
              userId: ctx.userId,
              ...(snapshot ? { snapshot: ctx.snapshot ?? null } : {}),
            }),
        },
        text: async (t) => {
          if (hiding(t)) return `Скрыть ${title(t)}`;
          const parts = [];
          for (const name of changed(t)) {
            if (ROWS[name]) {
              parts.push(...ROWS[name](t).map((row) => row.text));
              continue;
            }
            const value = await plain(t, name);
            if (value === "очистить") parts.push(`${LABELS[name]} — очистить`);
            else parts.push(`${LABELS[name]} → «${value}»`);
          }
          return `Изменить ${title(t)}: ${parts.join(", ")}`;
        },
        // Страница: строка на изменённое поле; «было» — из проверки сервиса
        page: async (t) => {
          const before = t.checked?.before ?? {};
          const out = [];
          for (const name of changed(t)) {
            if (ROWS[name]) {
              out.push(...ROWS[name](t).map(({ label, value, before: was }) => ({ label, value, before: was })));
              continue;
            }
            out.push({ label: LABELS[name], value: await plain(t, name), before: blank(before[name]) ? null : before[name] });
          }
          return {
            head: hiding(t) ? `Скрыть ${title(t)}` : `Изменить ${title(t)}`,
            fields: out,
          };
        },
      },
      deps,
    );
  };

  // Связь тип↔атрибут: «атрибут «A» у типа «T»». Тип и атрибут могут быть
  // скрытыми: так чистят связи скрытого атрибута
  const linkTargets = [target("type", { allowHidden: true }, "type"), target("attribute", { allowHidden: true }, "attribute")];
  const linkTitle = (t) => `атрибут ${quoted(t.view.attribute.name)} у типа ${quoted(t.view.type.name)}`;

  return {
    updateVendor: edit({
      word: "вендора",
      right: CATALOG_RIGHT,
      target: target("vendor", { allowHidden: true }),
      fields: [field("name"), bool("isActive")],
      svc: "UpdateVendor",
      hide: true,
    }),
    updateSupplier: edit({
      word: "поставщика",
      right: SUPPLIER_RIGHT,
      target: target("supplier", { allowHidden: true }),
      fields: [field("name"), bool("isActive"), ...["website", "inn", "kpp", "notes"].map(text)],
      svc: "UpdateSupplier",
      hide: true,
    }),
    updateModel: edit({
      word: "модель",
      right: CATALOG_RIGHT,
      target: target("model"),
      fields: [field("name"), entity("vendorId", "vendor"), text("notes"), field("compatibleWithModelIds", { ids: true })],
      lists: { compatibleWithModelIds: "DeviceModel" },
      svc: "UpdateModel",
    }),
    updateDeviceType: edit({
      word: "тип",
      right: CATALOG_RIGHT,
      target: target("type", { allowHidden: true }),
      fields: [
        field("name"),
        bool("isActive"),
        bool("isComponent"),
        bool("isConsumable"),
        bool("isPeripheral"),
        text("inventoryPrefix"),
        field("attachableToTypeIds", { ids: true }),
      ],
      lists: { attachableToTypeIds: "DeviceType" },
      svc: "UpdateDeviceType",
      hide: true,
    }),
    updateGroup: edit({
      word: "группу",
      right: CATALOG_RIGHT,
      target: target("group"),
      fields: [field("name"), field("order", { type: "number" })],
      svc: "UpdateGroup",
      collapse: true,
    }),
    // Тип значения не меняется (valueType — неизвестный параметр): переписывать
    // значения всех конфигураций правкой не берёмся
    updateAttribute: edit({
      word: "атрибут",
      right: CATALOG_RIGHT,
      target: target("attribute", { allowHidden: true }),
      fields: [
        field("name"),
        text("unit"),
        bool("isActive"),
        field("addOptions", { type: "array" }),
        field("renameOptions", { list: [field("from", { required: true }), field("to", { required: true })] }),
      ],
      check: (params) => (isStrings(params.addOptions) ? [] : ["параметр «addOptions» — список строк"]),
      svc: "UpdateAttribute",
      hide: true,
      snapshot: true,
      // id и код (в снимке переименования) — только когда варианты переименовываются
      mentions: (params, refs) =>
        params.renameOptions?.length ? [params.id, ...(refs ?? []).map((r) => r?.code)].filter(Boolean).map(String) : [],
    }),
    updateTypeAttribute: edit({
      word: "атрибут",
      right: CATALOG_RIGHT,
      target: linkTargets[0],
      targets: linkTargets,
      keys: ["type", "attribute"],
      title: linkTitle,
      fields: [bool("required"), field("order", { type: "number" }), entity("groupId", "group", { nullable: true })],
      svc: "UpdateTypeAttribute",
    }),
    unlinkAttribute: defineKind(
      {
        right: CATALOG_RIGHT,
        refKinds: [],
        fields: linkTargets,
        service: {
          check: (args, ctx) => ops().checkUnlinkAttribute(args, { allowNoop: Boolean(ctx.applying) }),
          apply: (args, ctx) => ops().applyUnlinkAttribute(args, { userId: ctx.userId }),
        },
        text: (t) => `Снять атрибут ${quoted(t.view.attribute.name)} с типа ${quoted(t.view.type.name)}`,
      },
      deps,
    ),
    updateConfiguration: edit({
      word: "конфигурацию",
      right: CATALOG_RIGHT,
      target: target("configuration"),
      fields: [
        field("name"),
        text("description"),
        // Снять значение — clearValues; в setValues value обязателен
        field("setValues", { list: [field("attribute", { required: true }), field("value", { type: "value", required: true })] }),
        field("clearValues", { type: "array" }),
      ],
      check: (params) => (isStrings(params.clearValues) ? [] : ["параметр «clearValues» — список кодов атрибутов"]),
      svc: "UpdateConfiguration",
    }),
    // Детали — целиком, по правилам createBuild; тип сборки не меняется
    updateBuild: edit({
      word: "шаблон сборки",
      right: CATALOG_RIGHT,
      target: target("build"),
      fields: [
        field("name"),
        text("notes"),
        field("parts", {
          list: [
            entity("type", "type", { to: "typeId", required: true }),
            entity("model", "model", { to: "deviceModelId", required: true }),
            entity("configuration", "configuration", { to: "configurationId" }),
            field("quantity", { type: "number" }),
          ],
        }),
      ],
      display: { parts: (t) => partsText(t.params.parts, t.show).join(", ") },
      svc: "UpdateBuild",
    }),
  };
};
