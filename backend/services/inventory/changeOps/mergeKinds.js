// Слияние дублей справочника: «Слить <вид> «A» в «B»». План, сверка снимка и
// перенос — catalogMerge; здесь поля агента, права и текст.
// source и target — только существующие живые записи (ссылка на операцию пакета
// не принимается, скрытую отказывает kit). Снимок ссылок плана уходит в refs
// операции; при применении — в catalogMerge.apply, до любой записи пакета —
// в drift (changeExecutor). Правило пакета (только по данным базы) — dataIds и
// mentions (id обеих записей, у атрибута — и их коды; у retireAttribute — его код).
//
// Текст (Telegram): заголовок, числа по видам ссылок, у модели — «конфигурация
// «S» сольётся с «T»» или «у «B» включится «Несколько конфигураций»», у атрибута —
// карта вариантов, новые варианты цели и совпавшие значения (notes плана), судьба
// источника. Страница: числа — табличкой, подстроки — первые 5 устройств ссылками,
// режим цели, notes и судьба источника с новым именем.
// Конфликт значений (атрибут, конфигурация) — отказ плана с перечнем конфигураций.
//
// Скрытие неиспользуемого (retire*, deleteGroup): параметр id — только существующая
// запись. План отказывает, пока на неё есть живые ссылки (с числами); снимок —
// в refs операции, при применении сверка (новая живая ссылка — дрейф) и скрытие без
// переименования. Текст: «Скрыть <вид> «A» (не используется)», «Удалить пустую группу «A»».
const { entity, field, defineKind } = require("./kit");

const CATALOG_RIGHT = { inventoryCatalog: ["manage"] };
const SUPPLIER_RIGHT = { supplier: ["manage"] };
const DEVICE_RIGHT = { device: ["manage"] };
const SHOWN_DEVICES = 5;

// what — в «Слить <вид>», noun — в подстроке страницы
const MERGES = {
  mergeVendors: { entity: "Vendor", kind: "vendor", what: "вендора", noun: "Вендор", right: CATALOG_RIGHT },
  mergeSuppliers: {
    entity: "Supplier",
    kind: "supplier",
    what: "поставщика",
    noun: "Поставщик",
    right: [SUPPLIER_RIGHT, DEVICE_RIGHT],
  },
  mergeGroups: { entity: "AttributeGroup", kind: "group", what: "группу", noun: "Группа", right: CATALOG_RIGHT, drop: true },
  mergeModels: { entity: "DeviceModel", kind: "model", what: "модель", noun: "Модель", right: [CATALOG_RIGHT, DEVICE_RIGHT] },
  // optionMap { вариант источника: вариант цели } — у select/multiselect
  mergeAttributes: {
    entity: "DeviceAttribute",
    kind: "attribute",
    what: "атрибут",
    noun: "Атрибут",
    right: CATALOG_RIGHT,
    extra: [field("optionMap", { type: "map" })],
  },
  mergeConfigurations: {
    entity: "DeviceConfiguration",
    kind: "configuration",
    what: "конфигурацию",
    noun: "Конфигурация",
    right: [CATALOG_RIGHT, DEVICE_RIGHT],
  },
  mergeDeviceTypes: { entity: "DeviceType", kind: "type", what: "тип", noun: "Тип", right: [CATALOG_RIGHT, DEVICE_RIGHT] },
};

// what — в «Скрыть <вид>»; deleteGroup — удаление насовсем
const RETIRES = {
  retireVendor: { entity: "Vendor", kind: "vendor", what: "вендора", right: CATALOG_RIGHT },
  retireSupplier: { entity: "Supplier", kind: "supplier", what: "поставщика", right: SUPPLIER_RIGHT },
  retireModel: { entity: "DeviceModel", kind: "model", what: "модель", right: CATALOG_RIGHT },
  retireAttribute: { entity: "DeviceAttribute", kind: "attribute", what: "атрибут", right: CATALOG_RIGHT },
  retireDeviceType: { entity: "DeviceType", kind: "type", what: "тип", right: CATALOG_RIGHT },
  deleteGroup: { entity: "AttributeGroup", kind: "group", right: CATALOG_RIGHT, drop: true },
};

// Существующая запись, без ссылки на операцию пакета
const existing = (name, kind) => {
  const f = entity(name, kind, { required: true });
  return { ...f, entity: { ...f.entity, refKind: null } };
};

const quoted = (name) => `«${name}»`;
// Ответ catalogMerge ({ error }) -> вид ответа сервиса для kit ({ message })
// moved отказа (перенесённое до сбоя) идёт дальше в итог операции
const asService = (result) =>
  result.ok
    ? result
    : {
        ok: false,
        status: result.status,
        message: result.error,
        ...(result.exception ? { error: result.exception } : {}),
        ...(result.moved ? { moved: result.moved } : {}),
      };

// id снимка слияния: обе записи, ссылки, гасимые вместе с источником, слияние конфигураций
const snapshotIds = (refs) => {
  if (!refs || !Array.isArray(refs.refs)) return [];
  const c = refs.collapse;
  return [
    refs.source,
    refs.target,
    ...refs.refs.flatMap((r) => r.ids ?? []),
    ...(refs.retire ?? []),
    ...(c ? [c.source, c.target, ...(c.refs ?? []).flatMap((r) => r.ids ?? [])] : []),
  ]
    .filter(Boolean)
    .map(String);
};

module.exports = (deps) => {
  const merge = () => deps.catalogMerge;

  const kind = ({ entity: model, kind: entityKind, what, noun, right, drop = false, extra = [] }) => {
    const names = (t) => ({ a: quoted(t.view.source.name), b: quoted(t.view.target.name) });
    const head = (t) => `Слить ${what} ${names(t).a} в ${names(t).b}`;
    // Конфигурации модели: сольются (одинаковые) или у цели включится режим нескольких
    const multiLine = (t) => {
      const c = t.checked?.collapse;
      if (c) return [`конфигурация ${quoted(c.from)} сольётся с ${quoted(c.into)}`];
      return t.checked?.multiOn ? [`у ${names(t).b} включится «Несколько конфигураций»`] : [];
    };
    // Подстроки вида: карта и новые варианты атрибута, совпавшие значения
    const notes = (t) => t.checked?.notes ?? [];
    const devicesLine = (t) => {
      const devices = t.checked?.devices ?? [];
      if (!devices.length) return [];
      const more = t.checked.moreDevices ? ` … и ещё ${t.checked.moreDevices}` : "";
      return [`Устройства: ${devices.map((d) => d.label).join(", ")}${more}`];
    };

    return defineKind(
      {
        right,
        refKinds: [],
        fields: [existing("source", entityKind), existing("target", entityKind), ...extra],
        service: {
          check: async (args, ctx) => {
            const options = { labels: !ctx.applying, ...(args.optionMap ? { optionMap: args.optionMap } : {}) };
            return asService(await merge().plan(model, args.source, args.target, options));
          },
          apply: async (args, ctx) => {
            const snapshot = ctx.snapshot;
            if (!snapshot || String(snapshot.source) !== args.source || String(snapshot.target) !== args.target) {
              return { ok: false, status: 409, message: "нет снимка ссылок — предложите слияние заново" };
            }
            return asService(await merge().apply(model, snapshot, { userId: ctx.userId }));
          },
        },
        drift: (_args, snapshot) => merge().drift(model, snapshot),
        dataIds: (params, refs) => [params.source, params.target, ...snapshotIds(refs)].filter(Boolean).map(String),
        // Коды атрибутов (снимок mergeAttributes) — setValues/values называют атрибут кодом
        mentions: (params, refs) => [params.source, params.target, ...(refs?.codes ?? [])].filter(Boolean).map(String),
        text: (t) => {
          const { a } = names(t);
          const fate = drop ? `группа ${a} удалится` : `${a} скроется`;
          return [head(t), ...(t.checked?.lines ?? []), ...multiLine(t), ...notes(t), fate];
        },
        page: (t) => {
          const { a } = names(t);
          const fate = drop ? `${noun} ${a} удалится` : `${noun} ${a} скроется и получит имя ${quoted(t.checked?.newName ?? "")}`;
          // «устройств: 12 и 1 удалённое» -> поле «устройств» = «12 и 1 удалённое»
          const fields = (t.checked?.lines ?? []).map((line) => {
            const at = line.indexOf(": ");
            return { label: line.slice(0, at), value: line.slice(at + 2) };
          });
          const devices = (t.checked?.devices ?? []).slice(0, SHOWN_DEVICES);
          return {
            head: head(t),
            fields,
            subs: [...devicesLine(t), ...multiLine(t), ...notes(t), fate],
            links: devices.map((d) => ({ model: "ClientDevice", id: d.id, label: d.label })),
          };
        },
      },
      deps,
    );
  };

  const retireKind = ({ entity: model, kind: entityKind, what, right, drop = false }) => {
    const name = (t) => quoted(t.view.id.name);
    const head = (t) => (drop ? `Удалить пустую группу ${name(t)}` : `Скрыть ${what} ${name(t)} (не используется)`);
    // Ссылаются только удалённые документы: остаются как есть
    const deletedLine = (t) => (t.checked?.lines?.length ? [`Ссылаются только удалённые — ${t.checked.lines.join(", ")}`] : []);
    return defineKind(
      {
        right,
        refKinds: [],
        fields: [existing("id", entityKind)],
        service: {
          check: async (args) => asService(await merge().planRetire(model, args.id)),
          apply: async (args, ctx) => {
            const snapshot = ctx.snapshot;
            if (!snapshot || String(snapshot.source) !== args.id) {
              return { ok: false, status: 409, message: "нет снимка ссылок — предложите скрытие заново" };
            }
            return asService(await merge().applyRetire(model, snapshot, { userId: ctx.userId }));
          },
        },
        drift: (_args, snapshot) => merge().driftRetire(model, snapshot),
        dataIds: (params, refs) => [params.id, ...snapshotIds(refs)].filter(Boolean).map(String),
        // У атрибута — и код (снимок planRetire): значения называют атрибут кодом
        mentions: (params, refs) => [params.id, ...(refs?.codes ?? [])].filter(Boolean).map((m) => String(m).toLowerCase()),
        text: (t) => [head(t), ...deletedLine(t)],
        page: (t) => ({ head: head(t), fields: [], subs: deletedLine(t), links: [] }),
      },
      deps,
    );
  };

  return {
    ...Object.fromEntries(Object.entries(MERGES).map(([name, spec]) => [name, kind(spec)])),
    ...Object.fromEntries(Object.entries(RETIRES).map(([name, spec]) => [name, retireKind(spec)])),
  };
};

module.exports.snapshotIds = snapshotIds;
