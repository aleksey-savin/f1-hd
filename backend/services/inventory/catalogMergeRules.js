// Правила слияния по видам записей для catalogMerge: модель, атрибут, конфигурация,
// тип. Общая механика (снимок, сверка, перенос по id, гашение) — catalogMerge.js.
//
// Крючки вида (все необязательны):
//   check({ src, tgt, sourceName, targetName, params }) -> отказ | null — до поиска ссылок
//   plan({ snapshot, src, tgt, sourceName, targetName, params }) -> отказ |
//     { extra (ключи снимка), targets (цели сверки), view: { multiOn?, collapse?, notes? } }
//   before({ snapshot, src, tgt, userId }) -> moved? — до общего переноса
//   skip(snapshot, entry) -> Set id: общий перенос их не трогает, числа не показывают
//   own(entry) -> true: путь переносит after, общий цикл его пропускает
//   rewire(entry) -> доп. поля store.rewire (unique — subdoc без дублей)
//   drift({ snapshot, current, targetName }) -> [фразы дрейфа]
//   after({ snapshot, src, tgt, userId }) -> moved — после общего переноса
//   retireSet(src, sourceId) -> доп. поля гашения источника
//
// Снимок сверх общего (refs операции):
//   модель — retire, multiOn, collapse (шапка catalogMerge);
//   атрибут — optionMap { из: в } (без тождественных), addOptions [{ value, label }],
//     values { drop:[id], move:[{ id, from, to }], keep:[id] }, dropLinks [id],
//     codes [код источника, код цели] (правило пакета: значения называют атрибут кодом);
//   тип — dropLinks [id].
// dropLinks — связи тип↔атрибут источника, чей «другой конец» уже связан с целью:
// удаляются до переноса (сверка считает их перенесёнными); настройки связи
// (required, order, groupId) остаются у связи цели. Так же со слотами, правилами
// помещений и ключевыми характеристиками при слиянии типов: элемент источника рядом
// с таким же элементом цели снимается, настройки (required, multiple, ответственный) —
// у элемента цели.
//
// Атрибут, значение источника в конфигурации (после optionMap; multiselect — через
// parseMultiValue, как attributeValue: строка не JSON — один элемент, сравнение —
// как множество, перенос — каноничным JSON-массивом):
//   у цели то же (multiselect — как множество) или у источника пусто — drop (убрать);
//   у цели пусто или нет — move (к цели; пустое значение цели снимается);
//   разные — конфликт: отказ при предложении; у удалённой конфигурации — keep
//   (значение остаётся у скрытого источника: править удалённую агент не может).
const { REF_TABLE, plural } = require("./catalogRefs");
const { parseMultiValue, formatSpecValue } = require("./assemblyKeySpecs");
const { renameValue } = require("./attributeValue");

const fail = (status, error) => ({ ok: false, status, error });
const key = (r) => `${r.model}:${r.path}`;
const metaOf = (entity, entry) => REF_TABLE[entity].find((t) => key(t) === key(entry));
const quoted = (name) => `«${name}»`;
const byId = (a, b) => (String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0);
const inConfigs = (n) => `${n} ${plural(n, "конфигурации", "конфигурациях", "конфигурациях")}`;
// Строки перечня в отказе (как подстроки Telegram); длинный перечень — с хвостом
const LISTED = 20;
const listLines = (lines) => [
  ...lines.slice(0, LISTED).map((line) => `   – ${line}`),
  ...(lines.length > LISTED ? [`   – … и ещё ${lines.length - LISTED}`] : []),
];

const CONFIG_KEY = "DeviceConfiguration:deviceModelId";
const VALUES_KEY = "DeviceConfiguration:values.attributeId";
const blankValue = (value) => value === undefined || value === null || ["", "[]"].includes(String(value).trim());
const filled = (config) => (config.values ?? []).filter((v) => !blankValue(v.value));
const isEmptyConfig = (config) => filled(config).length === 0;
// Значение для сравнения: JSON-массив (multiselect) — как множество
const valueKey = (value) => {
  const raw = String(value);
  return raw.trim().startsWith("[") ? JSON.stringify([...new Set(parseMultiValue(raw))].sort()) : raw;
};
const sameValues = (a, b) => {
  const map = (config) => new Map(filled(config).map((v) => [String(v.attributeId), valueKey(v.value)]));
  const ma = map(a);
  const mb = map(b);
  return ma.size === mb.size && [...ma].every(([id, value]) => mb.get(id) === value);
};
// Пустая с любой стороны или одинаковые; пустой цели достанутся значения источника
const collapsible = (s, t) => isEmptyConfig(s) || isEmptyConfig(t) || sameValues(s, t);
const plainValues = (config) => filled(config).map((v) => ({ attributeId: String(v.attributeId), value: String(v.value) }));
const liveOf = (configs) => configs.filter((c) => !c.deletedAt);
const configTarget = (c) => ({ model: "DeviceConfiguration", id: String(c._id), updatedAt: c.updatedAt ?? null });
// Подпись конфигурации: её имя, у безымянной — имя модели
const configLabel = (config, modelName) => config.name || modelName;
const valueOf = (config, attributeId) => (config.values ?? []).find((v) => String(v.attributeId) === attributeId);

const VALUE_TYPES = {
  string: "строка",
  number: "число",
  boolean: "да/нет",
  select: "один из списка",
  multiselect: "несколько из списка",
  text: "текст",
};
const OPTION_TYPES = new Set(["select", "multiselect"]);
const TYPE_FLAGS = [
  ["isComponent", "комплектующее"],
  ["isPeripheral", "периферия"],
  ["isConsumable", "расходник"],
];
// Пути типа, где элемент источника при паре с целью снимается, а не дублируется:
// поля, которые вместе с типом делают элемент тем же
const TYPE_UNIQUE = {
  "DeviceType:assembly.slots.typeId": [],
  "DeviceType:assembly.keySpecs.typeId": ["source", "attributeId"],
  "Location:responsibilityRules.deviceTypeOverrides.deviceType": [],
};

// multiselect: любая запись (JSON-массив или старая строка) -> множество для сравнения
const multiKey = (value) => JSON.stringify([...new Set(parseMultiValue(String(value)))].sort());
const keyFor = (valueType, value) => (valueType === "multiselect" ? multiKey(value) : valueKey(value));
// Значение источника после карты; multiselect — каноничным JSON-массивом
const mappedValue = (valueType, value, map) =>
  renameValue(valueType, valueType === "multiselect" ? JSON.stringify(parseMultiValue(String(value))) : String(value), map);

// Значение источника в конфигурации -> { action, from?, to?, there? } | null (значения нет)
const classify = (config, { source, target, valueType, map }) => {
  const s = valueOf(config, source);
  if (!s) return null;
  const t = valueOf(config, target);
  if (t && blankValue(s.value)) return { action: "drop" };
  const to = blankValue(s.value) ? s.value : mappedValue(valueType, s.value, map);
  if (!t || blankValue(t.value)) return { action: "move", from: s.value, to };
  if (keyFor(valueType, to) === keyFor(valueType, t.value)) return { action: "drop" };
  return { action: config.deletedAt ? "keep" : "conflict", from: s.value, to, there: t.value };
};

// optionMap агента -> { pairs: [[из, в]] без тождественных, add: варианты к цели } | отказ
const optionPlan = (src, tgt, optionMap) => {
  const entries = Object.entries(optionMap ?? {});
  if (!OPTION_TYPES.has(src.valueType)) {
    return entries.length ? fail(400, `У атрибута ${quoted(src.name)} нет вариантов`) : { pairs: [], add: [] };
  }
  const own = new Set((src.options ?? []).map((o) => String(o.value)));
  const theirs = new Set((tgt.options ?? []).map((o) => String(o.value)));
  for (const [from, to] of entries) {
    if (!own.has(from)) return fail(404, `Варианта ${quoted(from)} нет у атрибута ${quoted(src.name)}`);
    if (!theirs.has(to)) return fail(404, `Варианта ${quoted(to)} нет у атрибута ${quoted(tgt.name)}`);
  }
  const mapped = new Set(entries.map(([from]) => from));
  const add = [];
  for (const o of src.options ?? []) {
    const value = String(o.value);
    if (mapped.has(value) || theirs.has(value) || add.some((x) => x.value === value)) continue;
    add.push({ value, label: o.label ?? value });
  }
  return { pairs: entries.filter(([from, to]) => from !== to), add };
};

const createMergeRules = ({ refs, store, now, nameOf, adjusted, staying }) => {
  // Конфигурация пуста и на неё ничего не ссылается (и удалённое тоже)
  const unused = async (config) => isEmptyConfig(config) && (await refs.find("DeviceConfiguration", String(config._id))).length === 0;
  // Живых конфигураций будет у цели: её нынешние + переезжающие живые источника
  const liveAfter = async (target, moving) => (await store.configurations(target)).filter((c) => !c.deletedAt).length + moving;
  const movingLive = (snapshot, entry) =>
    (entry?.ids ?? []).filter((id) => !staying(snapshot).has(id) && !entry.deletedIds.includes(id)).length;

  // --- связи тип↔атрибут: объединение (атрибут — по типам, тип — по атрибутам) ---
  // field — путь источника в связи, other — её «другой конец»
  const linkDrops = async (field, other, source, target) => {
    const [mine, theirs] = await Promise.all([store.links(field, source), store.links(field, target)]);
    const taken = new Set(theirs.map((l) => String(l[other])));
    return { mine, drop: mine.filter((l) => taken.has(String(l[other]))).map((l) => String(l._id)).sort() };
  };
  const linkRules = (field, other, phrase) => ({
    before: async ({ snapshot, userId }) => {
      if (!snapshot.dropLinks?.length) return {};
      const n = await store.dropLinks({ ids: snapshot.dropLinks, field, source: snapshot.source, userId });
      return n ? { связей: n } : {};
    },
    // Классы связей источника сейчас против снимка: у «другого конца» связь с целью появилась или пропала
    drift: async (snapshot, targetName) => {
      const { mine, drop } = await linkDrops(field, other, snapshot.source, snapshot.target);
      const was = new Set(snapshot.dropLinks ?? []);
      const now = new Set(drop);
      const diff = [];
      for (const link of mine) {
        const id = String(link._id);
        if (was.has(id) === now.has(id)) continue;
        const name = await nameOf(other === "deviceTypeId" ? "DeviceType" : "DeviceAttribute", link[other]);
        diff.push(phrase(quoted(name), quoted(targetName), now.has(id) ? "появилась" : "пропала"));
      }
      return diff;
    },
  });

  // --- модель -------------------------------------------------------------------
  // Тип общий, пустые конфигурации источника не переезжают, у цели при нужде
  // включается «Несколько конфигураций». Две модели с одной конфигурацией (цель не
  // в режиме нескольких): одинаковые характеристики или пустая конфигурация — она
  // сливается с конфигурацией цели (collapse: её ссылки переводятся на конфигурацию
  // цели, сама гасится), режим не меняется
  const MODEL = {
    check: async ({ src, tgt }) => {
      if (String(src.deviceTypeId) === String(tgt.deviceTypeId)) return null;
      const [a, b] = await Promise.all([nameOf("DeviceType", src.deviceTypeId), nameOf("DeviceType", tgt.deviceTypeId)]);
      return fail(409, `Модели разных типов: ${quoted(a)} и ${quoted(b)} — устройства сменили бы тип`);
    },
    // retire — пустые конфигурации; collapse — слияние единственных конфигураций;
    // multiOn — у цели станет больше одной живой
    plan: async ({ snapshot, tgt, sourceName, targetName }) => {
      const entry = snapshot.refs.find((r) => key(r) === CONFIG_KEY);
      const configs = await store.configurations(snapshot.source);
      const byConfig = new Map(configs.map((c) => [String(c._id), c]));
      const retire = [];
      for (const id of entry?.ids ?? []) {
        const config = byConfig.get(id);
        if (config && (await unused(config))) retire.push(id);
      }
      const targets = retire.map((id) => byConfig.get(id)).filter((c) => !c.deletedAt).map(configTarget);
      const sourceLive = liveOf(configs).filter((c) => !retire.includes(String(c._id)));
      const targetLive = liveOf(await store.configurations(snapshot.target));
      let collapse = null;
      let names = null;
      if (!tgt.multiConfig && targetLive.length === 1 && sourceLive.length === 1 && collapsible(sourceLive[0], targetLive[0])) {
        const [s] = sourceLive;
        const [t] = targetLive;
        collapse = { source: String(s._id), target: String(t._id), refs: await refs.find("DeviceConfiguration", String(s._id)) };
        // Цель пуста, у источника значения есть — они переходят на конфигурацию цели
        if (isEmptyConfig(t) && !isEmptyConfig(s)) collapse.fill = true;
        names = { from: configLabel(s, sourceName), into: configLabel(t, targetName) };
        targets.push(configTarget(s), configTarget(t));
      }
      const extra = { retire, ...(collapse ? { collapse } : {}) };
      extra.multiOn = !tgt.multiConfig && (await liveAfter(snapshot.target, movingLive(extra, entry))) > 1;
      return { extra, targets, view: { multiOn: extra.multiOn, collapse: names } };
    },
    // До переноса: режим цели и значения её пустой конфигурации (правило режима — шапка catalogMerge)
    before: async ({ snapshot, tgt, userId }) => {
      if (snapshot.multiOn && !tgt.multiConfig) {
        await store.updateTarget("DeviceModel", snapshot.target, { set: { multiConfig: true } }, userId);
      }
      const c = snapshot.collapse;
      if (c?.fill) {
        const s = (await store.configurations(snapshot.source)).find((x) => String(x._id) === c.source);
        if (s && !isEmptyConfig(s)) await store.fillValues(c.target, plainValues(s), userId);
      }
      return {};
    },
    skip: (snapshot, entry) => (key(entry) === CONFIG_KEY ? staying(snapshot) : new Set()),
    drift: async ({ snapshot, current, targetName }) => {
      const diff = [];
      const configs = new Map((await store.configurations(snapshot.source)).map((c) => [String(c._id), c]));
      for (const id of snapshot.retire ?? []) {
        const config = configs.get(id);
        if (config && !config.deletedAt && !(await unused(config))) {
          diff.push(`конфигурация ${quoted(configLabel(config, await nameOf("DeviceModel", snapshot.source)))} уже не пустая`);
        }
      }
      const c = snapshot.collapse;
      if (c) {
        // Ссылки на сливаемую конфигурацию — по снимку; уже переведённые на конфигурацию цели — не дрейф
        const sub = { entity: "DeviceConfiguration", source: c.source, target: c.target, refs: c.refs };
        const s = configs.get(c.source);
        const t = (await store.configurations(snapshot.target)).find((x) => String(x._id) === c.target);
        const name = configLabel(s ?? {}, await nameOf("DeviceModel", snapshot.source));
        const recount = await adjusted(sub, await refs.find("DeviceConfiguration", c.source));
        diff.push(...refs.same(c.refs, recount, { entityLabel: "конфигурацию", name }).diff);
        const into = quoted(configLabel(t ?? {}, targetName));
        if (!t || t.deletedAt) diff.push(`конфигурация ${into} удалена`);
        else if (s && c.fill && !isEmptyConfig(t) && !sameValues(s, t)) diff.push(`у конфигурации ${into} появились значения`);
        else if (s && !s.deletedAt && !collapsible(s, t)) diff.push(`конфигурации ${quoted(name)} и ${into} уже различаются`);
      }
      const tgt = await store.get("DeviceModel", snapshot.target);
      if (tgt && !tgt.multiConfig && !snapshot.multiOn) {
        const moving = movingLive(snapshot, current.find((r) => key(r) === CONFIG_KEY));
        if ((await liveAfter(snapshot.target, moving)) > 1) diff.push(`у модели ${quoted(targetName)} изменился состав конфигураций`);
      }
      return diff;
    },
    // Слияние конфигураций, совместимость цели (объединение с источником без
    // неё самой), режим — по факту после переноса; гасятся пустые и слитая.
    // Отдаёт числа переноса ссылок слитой конфигурации
    after: async ({ snapshot, src, tgt, userId }) => {
      const c = snapshot.collapse;
      const moved = {};
      for (const entry of c?.refs ?? []) {
        const ref = metaOf("DeviceConfiguration", entry);
        if (!ref || !entry.ids.length) continue;
        const n = await store.rewire({ ...ref, ids: entry.ids, source: c.source, target: c.target, self: null, userId });
        const label = `${ref.countLabel} в конфигурацию цели`;
        if (n) moved[label] = (moved[label] ?? 0) + n;
      }
      const have = new Set((tgt.compatibleWithModelIds ?? []).map(String));
      const add = (src.compatibleWithModelIds ?? [])
        .map(String)
        .filter((id) => id !== snapshot.target && id !== snapshot.source && !have.has(id));
      const live = liveOf(await store.configurations(snapshot.target)).length;
      // Страховка: режим уже включён до переноса, если его обещал снимок (before)
      const set = !tgt.multiConfig && !snapshot.multiOn && live > 1 ? { multiConfig: true } : {};
      if (add.length || Object.keys(set).length) {
        const addToSet = add.length ? { compatibleWithModelIds: add } : {};
        await store.updateTarget("DeviceModel", snapshot.target, { addToSet, set }, userId);
      }
      const retire = [...staying(snapshot)];
      if (retire.length) await store.retireMany("DeviceConfiguration", retire, { userId, now: now() });
      return moved;
    },
  };

  // --- атрибут ------------------------------------------------------------------
  const attrLinks = linkRules("attributeId", "deviceTypeId", (other, target, how) => `у типа ${other} ${how} связь с ${target}`);
  // Значения источника по конфигурациям ids: классы для снимка и конфликты живых
  const sortValues = async (ids, ctx) => {
    const values = { drop: [], move: [], keep: [] };
    const conflicts = [];
    for (const config of (await store.configs(ids)).sort(byId)) {
      const r = classify(config, ctx);
      if (!r) continue;
      const id = String(config._id);
      if (r.action === "move") values.move.push({ id, from: r.from, to: r.to });
      else if (r.action === "conflict") conflicts.push({ config, ...r });
      else values[r.action].push(id);
    }
    return { values, conflicts };
  };
  const ATTRIBUTE = {
    check: ({ src, tgt }) =>
      src.valueType === tgt.valueType
        ? null
        : fail(
            409,
            `Атрибуты с разным видом значений: ${quoted(src.name)} — ${VALUE_TYPES[src.valueType] ?? src.valueType}, ` +
              `${quoted(tgt.name)} — ${VALUE_TYPES[tgt.valueType] ?? tgt.valueType}`,
          ),
    plan: async ({ snapshot, src, tgt, sourceName, targetName, params }) => {
      const options = optionPlan(src, tgt, params.optionMap);
      if (options.ok === false) return options;
      const entry = snapshot.refs.find((r) => key(r) === VALUES_KEY);
      const ctx = { source: snapshot.source, target: snapshot.target, valueType: src.valueType, map: new Map(options.pairs) };
      const { values, conflicts } = await sortValues(entry?.ids ?? [], ctx);
      if (conflicts.length) {
        const lines = [];
        for (const { config, from, to, there } of conflicts) {
          const model = await nameOf("DeviceModel", config.deviceModelId);
          const where = config.name ? `${model} ${quoted(config.name)}` : model;
          // Значение источника после карты — «серый → grey»: видно, почему разные
          const mapped = keyFor(src.valueType, to) === keyFor(src.valueType, from) ? "" : ` → ${formatSpecValue(tgt, to)}`;
          lines.push(`${where}: ${formatSpecValue(src, from)}${mapped} и ${formatSpecValue(tgt, there)}`);
        }
        const head = `слить атрибут ${quoted(sourceName)} в ${quoted(targetName)} нельзя — в ${inConfigs(conflicts.length)} разные значения:`;
        const text = [head, ...listLines(lines), "Сначала поправьте эти конфигурации отдельным предложением."].join("\n");
        return { ...fail(409, text), conflicts: lines };
      }
      const { drop } = await linkDrops("attributeId", "deviceTypeId", snapshot.source, snapshot.target);
      const deleted = new Set(entry?.deletedIds ?? []);
      const dropLive = values.drop.filter((id) => !deleted.has(id)).length;
      const notes = [
        ...(options.pairs.length ? [`варианты: ${options.pairs.map(([f, t]) => `${quoted(f)} → ${quoted(t)}`).join(", ")}`] : []),
        ...(options.add.length ? [`к ${quoted(targetName)} добавятся варианты: ${options.add.map((o) => quoted(o.value)).join(", ")}`] : []),
        ...(dropLive
          ? [`в ${inConfigs(dropLive)} значение уже есть у ${quoted(targetName)} — значение ${quoted(sourceName)} уберётся`]
          : []),
      ];
      const codes = [src.code, tgt.code].filter(Boolean).map((code) => String(code).toLowerCase());
      const extra = { optionMap: Object.fromEntries(options.pairs), addOptions: options.add, values, dropLinks: drop, codes };
      return { extra, view: { notes } };
    },
    // Варианты цели — до значений; связи-дубли — до переноса остальных
    before: async ({ snapshot, userId }) => {
      if (snapshot.addOptions?.length) await store.addOptions(snapshot.target, snapshot.addOptions, userId);
      return attrLinks.before({ snapshot, userId });
    },
    own: (entry) => key(entry) === VALUES_KEY,
    // Та же характеристика уже по цели — характеристика источника снимается
    rewire: (entry) => (key(entry) === "DeviceType:assembly.keySpecs.attributeId" ? { unique: ["typeId", "source"] } : {}),
    skip: (snapshot, entry) => new Set(key(entry) === VALUES_KEY ? (snapshot.values?.keep ?? []) : []),
    drift: async ({ snapshot, targetName }) => {
      const [src, tgt, sourceName] = await Promise.all([
        store.get("DeviceAttribute", snapshot.source),
        store.get("DeviceAttribute", snapshot.target),
        nameOf("DeviceAttribute", snapshot.source),
      ]);
      if (!src || !tgt) return [];
      const diff = [];
      if (src.valueType !== tgt.valueType) diff.push(`у ${quoted(targetName)} другой вид значений`);
      const have = new Set((tgt.options ?? []).map((o) => String(o.value)));
      for (const to of Object.values(snapshot.optionMap ?? {})) {
        if (!have.has(to)) diff.push(`у ${quoted(targetName)} нет варианта ${quoted(to)}`);
      }
      // Конфигурации снимка, где значение источника ещё есть: класс тот же, что при предложении
      const v = snapshot.values ?? { drop: [], move: [], keep: [] };
      const was = new Map([
        ...v.drop.map((id) => [id, "drop"]),
        ...v.keep.map((id) => [id, "keep"]),
        ...v.move.map((m) => [m.id, `move:${m.from}:${m.to}`]),
      ]);
      const ctx = { source: snapshot.source, target: snapshot.target, valueType: src.valueType, map: new Map(Object.entries(snapshot.optionMap ?? {})) };
      let changed = 0;
      for (const config of await store.configs([...was.keys()])) {
        const r = classify(config, ctx);
        if (!r) continue;
        const now = r.action === "move" ? `move:${r.from}:${r.to}` : r.action;
        if (now !== was.get(String(config._id))) changed += 1;
      }
      if (changed) diff.push(`значения ${quoted(sourceName)} и ${quoted(targetName)} изменились в ${inConfigs(changed)}`);
      diff.push(...(await attrLinks.drift(snapshot, targetName)));
      return diff;
    },
    // Значения: убрать совпавшие, перенести остальные (по исходному значению — повтор не пишет дважды)
    after: async ({ snapshot, userId }) => {
      const v = snapshot.values ?? { drop: [], move: [] };
      const { source, target } = snapshot;
      let n = 0;
      if (v.drop.length) n += await store.dropValues({ ids: v.drop, source, userId });
      const groups = new Map();
      for (const m of v.move) {
        const k = JSON.stringify([m.from, m.to]);
        if (!groups.has(k)) groups.set(k, { from: m.from, to: m.to, ids: [] });
        groups.get(k).ids.push(m.id);
      }
      for (const g of groups.values()) n += await store.moveValues({ ...g, source, target, userId });
      return n ? { значений: n } : {};
    },
    // Код освобождается вместе с именем
    retireSet: (src, sourceId) => ({ code: `${src.code}_merged_${String(sourceId).slice(-6)}` }),
  };

  // --- конфигурация -------------------------------------------------------------
  // Значения источника, которых у цели нет или они другие: «атрибут: a и b»
  const valueGaps = async (src, tgt) => {
    const theirs = new Map(filled(tgt).map((v) => [String(v.attributeId), v.value]));
    const out = [];
    for (const v of filled(src)) {
      const there = theirs.get(String(v.attributeId));
      const attr = await store.get("DeviceAttribute", v.attributeId);
      if (there !== undefined && keyFor(attr?.valueType, there) === keyFor(attr?.valueType, v.value)) continue;
      const shown = there === undefined ? "не задано" : formatSpecValue(attr, there);
      out.push(`${attr?.name ?? "атрибут"}: ${formatSpecValue(attr, v.value)} и ${shown}`);
    }
    return out;
  };
  const CONFIGURATION = {
    check: async ({ src, tgt }) => {
      if (String(src.deviceModelId) !== String(tgt.deviceModelId)) {
        const [a, b] = await Promise.all([nameOf("DeviceModel", src.deviceModelId), nameOf("DeviceModel", tgt.deviceModelId)]);
        return fail(409, `Конфигурации разных моделей: ${quoted(a)} и ${quoted(b)}`);
      }
      // Модель общая; удалённая — конфигурации её не сливаются (выбрать скрытое нельзя)
      const model = await store.get("DeviceModel", src.deviceModelId);
      if (!model?.deletedAt) return null;
      const name = await nameOf("DeviceModel", src.deviceModelId);
      return fail(409, `Слить можно только конфигурации живой модели: модель ${quoted(name)} скрыта`);
    },
    // Значения цели не меняются: всё, что есть у источника, у цели должно быть тем же
    plan: async ({ src, tgt, sourceName, targetName }) => {
      const gaps = await valueGaps(src, tgt);
      if (!gaps.length) return {};
      const head = `слить конфигурацию ${quoted(sourceName)} в ${quoted(targetName)} нельзя — значения различаются:`;
      const text = [head, ...listLines(gaps), "Сначала поправьте конфигурации отдельным предложением."].join("\n");
      return { ...fail(409, text), conflicts: gaps };
    },
    drift: async ({ snapshot, targetName }) => {
      const [src, tgt] = await Promise.all([
        store.get("DeviceConfiguration", snapshot.source),
        store.get("DeviceConfiguration", snapshot.target),
      ]);
      if (!src || !tgt || src.deletedAt || !(await valueGaps(src, tgt)).length) return [];
      const name = await nameOf("DeviceConfiguration", snapshot.source);
      return [`конфигурации ${quoted(name)} и ${quoted(targetName)} уже различаются`];
    },
  };

  // --- тип ----------------------------------------------------------------------
  const typeLinks = linkRules("deviceTypeId", "attributeId", (other, target, how) => `у ${target} ${how} связь с атрибутом ${other}`);
  const TYPE = {
    // Сборочная схема и шаблоны сборки переносятся только в портале
    check: ({ src, tgt, sourceName, targetName }) => {
      const a = src.assembly ?? {};
      if (a.enabled || a.slots?.length || a.keySpecs?.length) {
        return fail(409, `У типа ${quoted(sourceName)} есть сборочная схема — слияние таких типов только в портале`);
      }
      const differ = TYPE_FLAGS.filter(([flag]) => Boolean(src[flag]) !== Boolean(tgt[flag])).map(([, label]) => label);
      if (!differ.length) return null;
      return fail(409, `У типов ${quoted(sourceName)} и ${quoted(targetName)} разные признаки: ${differ.join(", ")}`);
    },
    plan: async ({ snapshot, sourceName }) => {
      if (snapshot.refs.find((r) => key(r) === "DeviceBuild:deviceTypeId")?.live) {
        return fail(409, `У типа ${quoted(sourceName)} есть шаблоны сборки — слияние таких типов только в портале`);
      }
      const { drop } = await linkDrops("deviceTypeId", "attributeId", snapshot.source, snapshot.target);
      return { extra: { dropLinks: drop } };
    },
    before: typeLinks.before,
    rewire: (entry) => (TYPE_UNIQUE[key(entry)] ? { unique: TYPE_UNIQUE[key(entry)] } : {}),
    drift: ({ snapshot, targetName }) => typeLinks.drift(snapshot, targetName),
    // «Прикрепляется к» источника — к цели (без неё самой и источника); префикс — цели
    after: async ({ snapshot, src, tgt, userId }) => {
      const have = new Set((tgt.attachableToTypeIds ?? []).map(String));
      const add = (src.attachableToTypeIds ?? [])
        .map(String)
        .filter((id) => id !== snapshot.target && id !== snapshot.source && !have.has(id));
      if (add.length) await store.updateTarget("DeviceType", snapshot.target, { addToSet: { attachableToTypeIds: add } }, userId);
      return {};
    },
  };

  return { DeviceModel: MODEL, DeviceAttribute: ATTRIBUTE, DeviceConfiguration: CONFIGURATION, DeviceType: TYPE };
};

module.exports = { createMergeRules, fail, key, metaOf, quoted };
