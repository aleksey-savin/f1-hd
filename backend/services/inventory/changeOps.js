// Реестр операций пакета изменений инвентаря (предложения ИИ-агента). Каждый
// вид: право, что может стоять за ссылкой на него (refKinds), check и apply.
// Здесь — пакет целиком: ссылки между операциями, права, применение по
// порядку. Виды описаны в changeOps/catalogKinds.js, catalogEditKinds.js, mergeKinds.js
// и deviceKinds.js, общая механика — changeOps/kit.js.
//
//   checkPackage(operations, ctx) -> { ok, reasons, items:[{ kind, ref, params,
//     text, page, targets, componentIds?, componentRefs?, refs? }] }
//     (page — вид операции для страницы портала, см. defineKind в kit.js)
//   requiredRights(operations) -> statement[]
//   applyPackage(items, ctx) -> { results:[{ state, error?, created?, moved? }], status }
//     (moved — у слияний: { [подпись счётчика]: число перенесённых документов })
//   snapshotDrift(item) -> текст дрейфа снимка refs | null (до любой записи, changeExecutor)
//
// Правило пакета для слияний и скрытия (у вида есть dataIds): только по данным базы.
// Если любая другая операция пакета — раньше или позже — называет источник или цель
// в параметрах (id, у атрибута — и код: mentions вида) или её цели (детали каскада, снимок другого слияния) пересекаются с
// id этой операции — отказ «слияние или скрытие предложите отдельным пакетом после
// утверждения этого». Проверяется после разбора всех операций.
// Каталог (catalog) подхватывает типы, атрибуты и группы по имени и коду: слияние
// или скрытие типа, атрибута, группы и deleteGroup рядом с ним — тот же отказ.
// Правка с одними mentions (updateAttribute с renameOptions: id и код) — то же
// правило: другая операция пакета, назвавшая атрибут, — отказ.
//
// ctx = { userId, now, onResult? } (onResult(index, result) — после каждой выполненной операции).
const { REF_RE, isPlain, entities, lowerIds, shapeErrors, humanError } = require("./changeOps/kit");
const catalogKinds = require("./changeOps/catalogKinds");
const logger = require("../../utils/logger");
const deviceKinds = require("./changeOps/deviceKinds");
const catalogEditKinds = require("./changeOps/catalogEditKinds");
const mergeKinds = require("./changeOps/mergeKinds");

const { catalogEntry } = catalogKinds;

// Что создаёт операция (для причин «ссылка … — вендор, а нужна модель»)
const CREATES = {
  catalog: "каталог",
  createVendor: "вендор",
  createSupplier: "поставщик",
  createModel: "модель",
  createConfiguration: "конфигурация",
  createBuild: "сборка",
  createDevice: "устройство",
};
const NEEDED = {
  type: "нужен тип",
  attribute: "нужен атрибут",
  vendor: "нужен вендор",
  supplier: "нужен поставщик",
  model: "нужна модель",
  configuration: "нужна конфигурация",
  build: "нужна сборка",
  device: "нужно устройство",
};
const KEY_OF = { type: "типа", attribute: "атрибута" };
const SEPARATE = "слияние или скрытие предложите отдельным пакетом после утверждения этого";
// Слияние и скрытие того, что каталог может подхватить
const NEAR_CATALOG = new Set(["mergeDeviceTypes", "mergeAttributes", "mergeGroups", "retireDeviceType", "retireAttribute", "deleteGroup"]);

// Строки-id где угодно в параметрах (вглубь)
const idsIn = (value, out = new Set()) => {
  if (typeof value === "string") out.add(value.toLowerCase());
  else if (Array.isArray(value)) value.forEach((item) => idsIn(item, out));
  else if (isPlain(value)) Object.values(value).forEach((item) => idsIn(item, out));
  return out;
};

// right вида — одно утверждение или список (нужны все): плоский список без повторов
const uniqueStatements = (rights) => {
  const seen = new Map();
  for (const statement of rights.flat()) {
    const key = JSON.stringify(statement);
    if (!seen.has(key)) seen.set(key, JSON.parse(key));
  }
  return [...seen.values()];
};

/**
 * deps: { deviceOps, catalogOps, catalogEditOps, catalogMerge, describe(model, id) -> { name, updatedAt } | null,
 * attributeNames?(codes) -> { code: name }, liveParts?(hostId) -> [id] (состав
 * хоста для отложенного каскада; без него — «вместе со всеми деталями»),
 * log?(level, message, meta) }.
 * Тесты подставляют подделки.
 */
const createChangeOps = (deps) => {
  const KINDS = Object.freeze({
    ...catalogKinds(deps),
    ...catalogEditKinds(deps),
    ...mergeKinds(deps),
    ...deviceKinds(deps),
  });

  // Правило пакета (см. шапку): элемент с dataIds против остальных элементов пакета
  const touchesOthers = (def, item, others) => {
    const own = new Set((def.dataIds?.(item.params, item.refs) ?? []).map((id) => id.toLowerCase()));
    // Упоминания: id источника и цели, у атрибута — и коды (mentions вида)
    const ends = def.mentions
      ? def.mentions(item.params, item.refs).map((m) => String(m).toLowerCase())
      : entities(def.fields, item.params).filter(({ parsed }) => parsed.id).map(({ parsed }) => parsed.id);
    return others.some((other) => {
      const mentioned = idsIn(other.params);
      if (ends.some((id) => mentioned.has(id))) return true;
      const otherDef = KINDS[other.kind];
      const theirs = [
        ...other.targets.map((target) => String(target.id)),
        ...(other.componentIds ?? []).map(String),
        ...(otherDef?.dataIds ? otherDef.dataIds(other.params, other.refs) : []),
      ];
      return theirs.some((id) => own.has(id.toLowerCase()));
    });
  };

  // Ссылки параметров операции index на операции пакета. refs: ref -> { index, kind, params }
  const refErrors = (def, params, index, refs) => {
    const errors = [];
    for (const { path, spec, parsed } of entities(def.fields, params)) {
      if (!parsed.ref) continue;
      const { ref, key } = parsed;
      const target = refs.get(ref);
      if (!target) {
        errors.push(`ссылка ${ref} не найдена`);
        continue;
      }
      if (target.index >= index) {
        errors.push(`ссылка ${ref} ещё не определена`);
        continue;
      }
      if (!KINDS[target.kind].refKinds.includes(spec.refKind)) {
        errors.push(`ссылка ${ref} в «${path}» — ${CREATES[target.kind] ?? target.kind}, а ${NEEDED[spec.refKind]}`);
        continue;
      }
      if (target.kind === "catalog") {
        if (typeof key !== "string") errors.push(`ссылка ${ref} на каталог — укажите key ${KEY_OF[spec.refKind]}`);
        else if (!catalogEntry(target.params, spec.refKind, key)) {
          errors.push(`в каталоге ${ref} нет ${KEY_OF[spec.refKind]} с key «${key}»`);
        }
      } else if (key !== undefined) {
        errors.push(`key бывает только у ссылки на каталог (${ref})`);
      }
    }
    return errors;
  };

  const checkPackage = async (operations, ctx = {}) => {
    if (!Array.isArray(operations)) {
      return { ok: false, reasons: ["Операции должны быть списком"], items: [] };
    }

    // Проход 1: вид и ref каждой операции; занятые ref -> операция
    const perOp = operations.map(() => []);
    const refs = new Map();
    operations.forEach((op, index) => {
      const errors = perOp[index];
      if (!isPlain(op)) return errors.push("должна быть объектом { kind, ref?, params }");
      const def = Object.hasOwn(KINDS, op.kind) ? KINDS[op.kind] : null;
      if (!def) errors.push(`неизвестный вид операции «${op.kind}»`);
      if (op.ref === undefined || op.ref === null) return;
      if (typeof op.ref !== "string" || !REF_RE.test(op.ref)) {
        return errors.push(`ref «${op.ref}» должен быть вида ^[a-z][a-z0-9_]{0,31}$`);
      }
      if (refs.has(op.ref)) return errors.push(`ref ${op.ref} уже есть у операции ${refs.get(op.ref).index + 1}`);
      if (def && def.refKinds.length === 0) {
        return errors.push(`операция ${op.kind} ничего не создаёт — ref не нужен`);
      }
      if (def) refs.set(op.ref, { index, kind: op.kind, params: op.params, def });
    });

    // Проход 2: параметры, ссылки, проверка вида со ссылками на ещё не созданное.
    // touched — устройства, которые меняют уже разобранные операции (их цели и
    // детали каскада): операция над ними проверяется при применении.
    const items = [];
    // Номер операции каждого элемента (для причин правила пакета)
    const itemIndex = [];
    const touched = new Set();
    for (const [index, op] of operations.entries()) {
      const errors = perOp[index];
      const def = isPlain(op) && Object.hasOwn(KINDS, op.kind) ? KINDS[op.kind] : null;
      if (!def) continue;
      const raw = op.params ?? {};
      const shape = shapeErrors(def.fields, raw);
      if (shape.length) {
        errors.push(...shape);
        continue;
      }
      // id в одном регистре: дальше их сравнивают как строки
      const params = lowerIds(def.fields, raw);
      const linkErrors = refErrors(def, params, index, refs);
      if (linkErrors.length) {
        errors.push(...linkErrors);
        continue;
      }
      const pending = new Map([...refs].filter(([, entry]) => entry.index < index));
      let checked;
      try {
        const earlier = items.map(({ kind, ref, params: before }) => ({ kind, ref, params: before }));
        checked = await def.check(params, { ...ctx, pending, touched: new Set(touched), earlier });
      } catch (error) {
        checked = { ok: false, errors: [humanError({ error }, deps.log)] };
      }
      if (!checked.ok) {
        errors.push(...checked.errors);
        continue;
      }
      for (const target of checked.targets) if (target.model === "ClientDevice") touched.add(String(target.id));
      for (const id of checked.componentIds ?? []) touched.add(String(id));
      if (errors.length) continue;
      itemIndex.push(index);
      items.push({
        kind: op.kind,
        ref: op.ref ?? null,
        params,
        text: checked.text,
        ...(checked.page ? { page: checked.page } : {}),
        targets: checked.targets,
        ...(checked.componentIds ? { componentIds: checked.componentIds } : {}),
        ...(checked.componentRefs ? { componentRefs: checked.componentRefs } : {}),
        ...(checked.refs ? { refs: checked.refs } : {}),
      });
    }

    // Правило пакета для слияний и скрытия — в обе стороны, по всем разобранным операциям
    const withCatalog = operations.some((op) => isPlain(op) && op.kind === "catalog");
    items.forEach((item, i) => {
      const def = KINDS[item.kind];
      const near = withCatalog && NEAR_CATALOG.has(item.kind);
      const ruled = def.dataIds || def.mentions;
      if (near || (ruled && touchesOthers(def, item, items.filter((_, j) => j !== i)))) perOp[itemIndex[i]].push(SEPARATE);
    });

    const reasons = perOp.flatMap((errors, index) => errors.map((text) => `Операция ${index + 1}: ${text}`));
    return { ok: reasons.length === 0, reasons, items };
  };

  // Права пакета: по утверждению на вид, без повторов, в порядке появления
  const requiredRights = (operations) =>
    uniqueStatements(
      (Array.isArray(operations) ? operations : [])
        .map((op) => (isPlain(op) && Object.hasOwn(KINDS, op.kind) ? KINDS[op.kind].right : null))
        .filter(Boolean),
    );

  // Подстановка id, созданных ранее в пакете: { ref } -> created[ref][refKind],
  // { ref, key } -> created[ref][refKind][key]. Параметры пакета не меняются.
  const resolve = (def, params, created) => {
    const copy = structuredClone(params);
    for (const { spec, parsed, set } of entities(def.fields, copy)) {
      if (!parsed.ref) continue;
      const made = created.get(parsed.ref)?.[spec.refKind];
      const id = parsed.key === undefined ? made : made?.[parsed.key];
      if (typeof id !== "string") return { error: "не создано на предыдущем шаге" };
      set(id);
    }
    return { params: copy };
  };

  const applyItem = async (item, created, ctx) => {
    const def = Object.hasOwn(KINDS, item.kind) ? KINDS[item.kind] : null;
    if (!def) return { state: "failed", error: `неизвестный вид операции «${item.kind}»` };
    const resolved = resolve(def, item.params ?? {}, created);
    if (resolved.error) return { state: "failed", error: resolved.error };
    // Каскад отложенной операции: к снимку существующих деталей — детали,
    // созданные выше в этом же применении (по их ref)
    let componentIds = item.componentIds;
    if (item.componentRefs?.length) {
      const made = item.componentRefs.map((ref) => created.get(ref)?.device);
      if (made.some((id) => typeof id !== "string")) return { state: "failed", error: "не создано на предыдущем шаге" };
      componentIds = [...(componentIds ?? []), ...made];
    }
    // snapshot — снимок ссылок из предложения (refs): сверка дрейфа и запись по нему
    const opCtx = {
      ...ctx,
      applying: true,
      ...(componentIds ? { componentIds } : {}),
      ...(item.refs ? { snapshot: item.refs } : {}),
    };
    try {
      // Повторная проверка уже с настоящими id, затем запись
      const checked = await def.check(resolved.params, opCtx);
      if (!checked.ok) return { state: "failed", error: checked.errors.join("; ") };
      const applied = await def.apply(resolved.params, opCtx);
      if (!applied.ok) return { state: "failed", error: applied.error, ...(applied.moved ? { moved: applied.moved } : {}) };
      return {
        state: "done",
        ...(applied.created ? { created: applied.created } : {}),
        ...(applied.moved ? { moved: applied.moved } : {}),
      };
    } catch (error) {
      return { state: "failed", error: humanError({ error }, deps.log) };
    }
  };

  // По порядку; на первом сбое остальные пропускаются, отката нет.
  // ctx.onResult(index, result) — после каждой выполненной операции (done или failed),
  // до следующей: так итог переживает обрыв применения (changeDecisions пишет его сразу).
  const applyPackage = async (items, ctx = {}) => {
    const { onResult, ...opCtx } = ctx;
    const created = new Map();
    const results = [];
    let failed = false;
    let done = 0;
    for (const [index, item] of items.entries()) {
      if (failed) {
        results.push({ state: "skipped" });
        continue;
      }
      const result = await applyItem(item, created, opCtx);
      results.push(result);
      if (onResult) await onResult(index, result);
      if (result.state === "failed") {
        failed = true;
        continue;
      }
      done += 1;
      if (item.ref && result.created) created.set(item.ref, result.created);
    }
    const status = !failed ? "done" : done ? "partial" : "failed";
    return { results, status };
  };

  // Сверка снимка refs операции до применения пакета (вид с drift и снимком)
  const snapshotDrift = async (item) => {
    const def = Object.hasOwn(KINDS, item.kind) ? KINDS[item.kind] : null;
    if (!def?.drift || !item.refs) return null;
    try {
      return (await def.drift(item.params ?? {}, item.refs)) || null;
    } catch (error) {
      return humanError({ error }, deps.log);
    }
  };

  return { KINDS, checkPackage, requiredRights, applyPackage, snapshotDrift };
};

// Экземпляр на настоящих сервисах
const defaultOps = createChangeOps({
  deviceOps: require("./deviceOps"),
  catalogOps: require("./catalogOps"),
  catalogEditOps: require("./catalogEditOps"),
  catalogMerge: require("./catalogMerge"),
  ...require("./changeOps/names"),
  log: (level, message, meta) => logger.log(level, message, meta),
});

module.exports = {
  createChangeOps,
  uniqueStatements,
  ...defaultOps,
};
