/**
 * Ключевые характеристики своей сборки для строки списка устройств.
 *
 * ВАЖНО: серверный порт `buildKeySpecs`/`keySpecsLine`/`partTitle`/`liveAssembly`
 * из frontend/src/components/app/assembly-specs.ts и `formatSpecValue` из
 * frontend/src/components/app/spec-sheet.ts. Правила и форматирование обязаны
 * совпадать с фронтом — меняя одно, меняй и другое (и тесты с теми же векторами).
 */

const MODEL_DELETED = "модель удалена";
const NO_MODEL = "без модели";

const idStr = (v) => (v === undefined || v === null ? "" : String(v._id ?? v));

/** Значение multiselect хранится JSON-массивом; не JSON — одно сырое значение. */
const parseMultiValue = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // не JSON — старое значение одной строкой
  }
  return [raw];
};

/** Человекочитаемое значение характеристики по типу атрибута. */
const formatSpecValue = (attr, raw) => {
  if (raw === undefined || raw === null || raw === "") return "";
  const type = attr?.valueType;
  if (type === "boolean" || typeof raw === "boolean") {
    return raw === true || raw === "true" ? "да" : "нет";
  }
  const text = String(raw);
  const labelOf = (v) => attr?.options?.find((o) => o.value === v)?.label ?? v;
  if (type === "select") return labelOf(text);
  if (type === "multiselect") {
    try {
      if (Array.isArray(JSON.parse(text))) {
        return parseMultiValue(text).map(labelOf).join(", ");
      }
    } catch {
      // сырое значение
    }
    return text;
  }
  const unit = attr?.unit;
  if (!unit) return text;
  return unit === '"' ? `${text}${unit}` : `${text} ${unit}`;
};

/** Слоты и ключевые характеристики удалённых типов (typeId: null) выпадают. */
const liveAssembly = (assembly) => {
  const slots = (assembly?.slots ?? []).filter((s) => s?.typeId);
  const keySpecs = (assembly?.keySpecs ?? []).filter((s) => s?.typeId);
  return { ...(assembly ?? {}), slots, keySpecs };
};

const hasModel = (p) => !!p.deviceModelId && !p.deviceModelId.deletedAt;

/** «Vendor Name» модели; модели нет — «без модели», удалена — «модель удалена». */
const partTitle = (part) => {
  const m = part.deviceModelId;
  if (!m) return NO_MODEL;
  if (m.deletedAt) return MODEL_DELETED;
  return [m.vendorId?.name, m.name].filter(Boolean).join(" ");
};

const qty = (p) => (p.quantity > 0 ? p.quantity : 1);

const valuesOf = (p) =>
  hasModel(p) ? (p.configurationId?.values ?? []) : [];

const parseNumber = (raw) => {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** Не больше 2 знаков после запятой, без хвостовых нулей. */
const roundNumber = (n) => String(Math.round(n * 100) / 100);

const distinct = (items) => [...new Set(items)];

const sameType = (p, typeId) => !!p.typeId && idStr(p.typeId) === typeId;

/** Значение одного keySpec по деталям его типа; пусто — нечего показать. */
const keySpecValue = (spec, parts) => {
  const specType = idStr(spec.typeId);
  const own = specType ? parts.filter((p) => sameType(p, specType)) : [];
  if (spec.source === "model") {
    return distinct(own.map(partTitle)).join(", ");
  }
  const attrId = idStr(spec.attributeId);
  const found = [];
  for (const p of own) {
    for (const v of valuesOf(p)) {
      if (idStr(v.attributeId) !== attrId) continue;
      const meta =
        typeof v.attributeId === "object" && v.attributeId
          ? v.attributeId
          : (spec.attributeId ?? null);
      found.push({ raw: v.value, meta, quantity: qty(p) });
    }
  }
  const meta = spec.attributeId ?? found[0]?.meta ?? null;
  if (spec.aggregate === "sum") {
    let total = 0;
    let any = false;
    for (const f of found) {
      const n = parseNumber(f.raw);
      if (n === null) continue;
      total += n * f.quantity;
      any = true;
    }
    return any ? formatSpecValue(meta, roundNumber(total)) : "";
  }
  const texts = found
    .map((f) => formatSpecValue(f.meta ?? meta, f.raw))
    .filter(Boolean);
  if (spec.aggregate === "list") return distinct(texts).join(", ");
  return texts[0] ?? "";
};

/**
 * По записи на тип слота в порядке первого появления в keySpecs. Если
 * передан `slots`, keySpecs чужих (не слотовых) типов игнорируются.
 */
const buildKeySpecs = (keySpecs, parts, slots) => {
  keySpecs = keySpecs.filter((s) => idStr(s.typeId));
  const allowed = slots
    ? new Set(slots.map((s) => idStr(s.typeId)).filter(Boolean))
    : null;
  if (allowed) keySpecs = keySpecs.filter((s) => allowed.has(idStr(s.typeId)));
  const order = [];
  for (const s of keySpecs) {
    if (!order.some((t) => idStr(t) === idStr(s.typeId))) order.push(s.typeId);
  }
  const result = [];
  for (const t of order) {
    const value = keySpecs
      .filter((s) => idStr(s.typeId) === idStr(t))
      .map((s) => keySpecValue(s, parts))
      .filter(Boolean)
      .join(" ");
    if (value) result.push({ typeId: idStr(t), label: t.name, value });
  }
  return result;
};

/** Строка «A · B · C» по сборке типа ({ keySpecs, slots }) и деталям. */
const keySpecsLine = ({ keySpecs = [], slots } = {}, parts = []) =>
  buildKeySpecs(keySpecs, parts, slots)
    .map((e) => e.value)
    .join(" · ");

// ─── Пачка для страницы списка ────────────────────────────────────────────

// Тип слота комплектующего: тип модели, иначе прямой тип устройства.
const childSlotType = (child) => {
  const t = child.deviceModelId?.deviceTypeId ?? child.deviceTypeId ?? null;
  return t && typeof t === "object" && t._id ? t : null;
};

const toAssemblyPart = (child) => ({
  typeId: childSlotType(child),
  deviceModelId: child.deviceModelId ?? null,
  configurationId: child.configurationId ?? null,
  quantity: child.quantity,
});

/**
 * keySpecs для строк списка: Map(hostId → строка). Хозяин — «своя сборка»
 * (без модели) типа с включённой сборкой. Два запроса на страницу (типы и
 * комплектующие хозяев) плюс их populate — не N+1.
 *
 * Зависимости передаются снаружи (модели, populate, условие видимости детей),
 * чтобы сервис не знал о контроллере, а тест мог подставить счётные заглушки.
 */
const loadKeySpecs = async (
  rows,
  { ClientDevice, DeviceType, assemblyPopulate, componentPopulate, componentSelect, componentsFilter },
) => {
  const result = new Map();
  const hosts = rows.filter((r) => !r.deviceModelId && r.deviceTypeId);
  if (!hosts.length) return result;

  const typeIds = distinct(hosts.map((r) => idStr(r.deviceTypeId)));
  const types = await DeviceType.find({
    _id: { $in: typeIds },
    "assembly.enabled": true,
  })
    .select("assembly")
    .populate(assemblyPopulate)
    .lean();
  const assemblies = new Map(
    types
      .map((t) => [idStr(t), liveAssembly(t.assembly)])
      .filter(([, a]) => a.keySpecs.length),
  );
  const assembled = hosts.filter((r) => assemblies.has(idStr(r.deviceTypeId)));
  if (!assembled.length) return result;

  const children = await ClientDevice.find(
    componentsFilter({ $in: assembled.map((r) => r._id) }),
  )
    .select(componentSelect)
    .populate(componentPopulate)
    .lean();
  const byHost = new Map();
  for (const c of children) {
    const key = idStr(c.parentDeviceId);
    if (!byHost.has(key)) byHost.set(key, []);
    byHost.get(key).push(toAssemblyPart(c));
  }

  for (const host of assembled) {
    const line = keySpecsLine(
      assemblies.get(idStr(host.deviceTypeId)),
      byHost.get(idStr(host._id)) ?? [],
    );
    if (line) result.set(idStr(host._id), line);
  }
  return result;
};

module.exports = {
  formatSpecValue,
  liveAssembly,
  partTitle,
  buildKeySpecs,
  keySpecsLine,
  loadKeySpecs,
};
