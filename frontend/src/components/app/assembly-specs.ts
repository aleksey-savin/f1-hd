/**
 * Сводка собственной сборки: ключевые характеристики для карточек, группы
 * характеристик всех деталей и строки «Конфигурации». Чистые функции —
 * их читают карточка сборки, карточка типа и тест на node:test.
 */

import {
  formatSpecValue,
  groupLinks,
  buildSpecGroups,
  type SpecAttr,
  type SpecGroup,
  type SpecLink,
  type SpecRow,
  type SpecValue,
} from "./spec-sheet.ts";

export interface AssemblyTypeRef {
  _id: string;
  name: string;
}

export interface AssemblyModel {
  _id: string;
  name: string;
  deletedAt?: string | null;
  vendorId?: { _id?: string; name?: string } | null;
}

export interface AssemblyConfiguration {
  _id: string;
  name?: string;
  deletedAt?: string | null;
  values?: SpecValue[];
}

// typeId — null, если тип удалён (populate не нашёл документ).
export interface AssemblyPart {
  typeId: AssemblyTypeRef | null;
  deviceModelId: AssemblyModel | null;
  configurationId?: AssemblyConfiguration | null;
  quantity: number;
  // Только у деталей конкретного устройства (devicePartsToAssembly).
  deviceId?: string;
  serialNumber?: string | null;
  warrantyExpirationDate?: string | null;
  inventoryNumber?: string | null;
}

export interface AssemblySlot {
  typeId: AssemblyTypeRef | null;
  required?: boolean;
  multiple?: boolean;
}

export interface AssemblyKeySpec {
  typeId: AssemblyTypeRef | null;
  source: "model" | "attribute";
  attributeId?: SpecAttr | null;
  aggregate: "first" | "sum" | "list";
}

export interface KeySpecEntry {
  typeId: string;
  label: string;
  value: string;
}

export interface PartRow {
  key: string;
  label: string;
  title: string;
  modelId: string | null;
  quantity: number;
}

const MODEL_DELETED = "модель удалена";
const NO_MODEL = "без модели";

/**
 * Сборка типа без слотов и ключевых характеристик, чей тип удалён (populate
 * вернул null): карточкам и форме они ни к чему, а `typeId._id` на них падает.
 */
export const liveAssembly = <
  A extends { slots?: { typeId?: unknown }[]; keySpecs?: { typeId?: unknown }[] },
>(
  assembly: A | null | undefined,
): A & { slots: NonNullable<A["slots"]>; keySpecs: NonNullable<A["keySpecs"]> } => {
  const slots = (assembly?.slots ?? []).filter((s) => s?.typeId);
  const keySpecs = (assembly?.keySpecs ?? []).filter((s) => s?.typeId);
  return { ...(assembly ?? ({} as A)), slots, keySpecs } as A & {
    slots: NonNullable<A["slots"]>;
    keySpecs: NonNullable<A["keySpecs"]>;
  };
};

const hasModel = (p: AssemblyPart): boolean =>
  !!p.deviceModelId && !p.deviceModelId.deletedAt;

/** «Vendor Name» модели; модели нет — «без модели», удалена — «модель удалена». */
export const partTitle = (part: AssemblyPart): string => {
  const m = part.deviceModelId;
  if (!m) return NO_MODEL;
  if (m.deletedAt) return MODEL_DELETED;
  return [m.vendorId?.name, m.name].filter(Boolean).join(" ");
};

/**
 * Короткое имя детали для сжатой сводки («Конфигурация» карточки): модель без
 * производителя (и в имени тоже) и без хвостов в скобках — «GeForce RTX 3060
 * WINDFORCE OC» вместо «Gigabyte … (rev. 2.0) [GV-N3060WF2OC-12GD 2.0]».
 */
export const shortPartTitle = (part: AssemblyPart): string => {
  const m = part.deviceModelId;
  if (!m || m.deletedAt) return partTitle(part);
  const vendor = m.vendorId?.name?.trim();
  let name = m.name.replace(/\s*(\([^)]*\)|\[[^\]]*\])/g, "").trim();
  if (vendor && name.toLowerCase().startsWith(`${vendor.toLowerCase()} `)) {
    name = name.slice(vendor.length).trim();
  }
  return name || m.name;
};

const qty = (p: AssemblyPart): number => (p.quantity > 0 ? p.quantity : 1);

const valuesOf = (p: AssemblyPart): SpecValue[] =>
  hasModel(p) ? (p.configurationId?.values ?? []) : [];

const attrIdOf = (a: SpecAttr | string | null | undefined): string =>
  (typeof a === "object" && a !== null ? a._id : a) ?? "";

const parseNumber = (raw: unknown): number | null => {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** Не больше 2 знаков после запятой, без хвостовых нулей. */
const roundNumber = (n: number): string => String(Math.round(n * 100) / 100);

const distinct = (items: string[]): string[] => [...new Set(items)];

const sameType = (p: AssemblyPart, typeId: string): boolean =>
  p.typeId?._id === typeId;

/** Значение одного keySpec по деталям его типа; пусто — нечего показать. */
const keySpecValue = (
  spec: AssemblyKeySpec,
  parts: AssemblyPart[],
  title: (part: AssemblyPart) => string = partTitle,
): string => {
  const own = spec.typeId ? parts.filter((p) => sameType(p, spec.typeId!._id)) : [];
  if (spec.source === "model") {
    return distinct(own.map(title)).join(", ");
  }
  const attrId = attrIdOf(spec.attributeId);
  const found: { raw: unknown; meta: SpecAttr | null; quantity: number }[] = [];
  for (const p of own) {
    for (const v of valuesOf(p)) {
      if (attrIdOf(v.attributeId) !== attrId) continue;
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
    .map((f) => formatSpecValue(f.meta ?? meta, f.raw as string))
    .filter(Boolean);
  if (spec.aggregate === "list") return distinct(texts).join(", ");
  return texts[0] ?? "";
};

/**
 * По записи на тип слота в порядке первого появления в keySpecs. Если
 * передан `slots`, keySpecs чужих (не слотовых) типов игнорируются: детали
 * вне слотов в ключевые характеристики не попадают.
 */
export const buildKeySpecs = (
  keySpecs: AssemblyKeySpec[],
  parts: AssemblyPart[],
  slots?: { typeId: AssemblyTypeRef | null }[],
  title: (part: AssemblyPart) => string = partTitle,
): KeySpecEntry[] => {
  keySpecs = keySpecs.filter((s) => s.typeId?._id);
  const allowed = slots
    ? new Set(slots.map((s) => s.typeId?._id).filter(Boolean))
    : null;
  if (allowed) keySpecs = keySpecs.filter((s) => allowed.has(s.typeId!._id));
  const order: AssemblyTypeRef[] = [];
  for (const s of keySpecs) {
    if (!order.some((t) => t._id === s.typeId!._id)) order.push(s.typeId!);
  }
  const result: KeySpecEntry[] = [];
  for (const t of order) {
    const value = keySpecs
      .filter((s) => s.typeId?._id === t._id)
      .map((s) => keySpecValue(s, parts, title))
      .filter(Boolean)
      .join(" ");
    if (value) result.push({ typeId: t._id, label: t.name, value });
  }
  return result;
};

export const keySpecsLine = (
  keySpecs: AssemblyKeySpec[],
  parts: AssemblyPart[],
  slots?: { typeId: AssemblyTypeRef | null }[],
): string =>
  buildKeySpecs(keySpecs, parts, slots)
    .map((e) => e.value)
    .join(" · ");

/** Сжатая сводка: модели — короткими именами (shortPartTitle). */
export const compactKeySpecsLine = (
  keySpecs: AssemblyKeySpec[],
  parts: AssemblyPart[],
  slots?: { typeId: AssemblyTypeRef | null }[],
): string =>
  buildKeySpecs(keySpecs, parts, slots, shortPartTitle)
    .map((e) => e.value)
    .join(" · ");

interface DistinctPart {
  part: AssemblyPart;
  quantity: number;
}

/** Одинаковые детали (модель + конфигурация) сводятся, количества складываются. */
const mergeParts = (parts: AssemblyPart[]): DistinctPart[] => {
  const map = new Map<string, DistinctPart>();
  for (const p of parts) {
    const key = `${p.deviceModelId?._id ?? ""}|${p.configurationId?._id ?? ""}`;
    const hit = map.get(key);
    if (hit) hit.quantity += qty(p);
    else map.set(key, { part: p, quantity: qty(p) });
  }
  return [...map.values()];
};

interface RowAcc {
  groupKey: string;
  id: string;
  label: string;
  values: string[];
}

/**
 * Группы характеристик всех деталей в форме buildSpecGroups. Порядок групп
 * глобальный (по группам связок всех типов), строки — по порядку деталей,
 * затем по связкам. Число при quantity > 1 — «N × v».
 */
export const buildAssemblyGroups = (
  parts: AssemblyPart[],
  partLinks: Record<string, SpecLink[]>,
  { otherLabel = "Прочее" }: { otherLabel?: string } = {},
): SpecGroup[] => {
  const typeIds = distinct(
    parts.map((p) => p.typeId?._id).filter((id): id is string => !!id),
  );
  const allLinks = typeIds.flatMap((t) => partLinks[t] ?? []);
  const groupOrder = groupLinks(allLinks, otherLabel);

  const rows = new Map<string, RowAcc>();
  for (const typeId of typeIds) {
    const links = partLinks[typeId] ?? [];
    const own = parts.filter((p) => sameType(p, typeId) && hasModel(p));
    for (const { part, quantity } of mergeParts(own)) {
      const values = valuesOf(part);
      const numeric = new Set(
        values
          .map((v) => (typeof v.attributeId === "object" ? v.attributeId : null))
          .filter((a) => a?.valueType === "number")
          .map((a) => a?._id),
      );
      for (const g of buildSpecGroups(links, values, { otherLabel })) {
        for (const r of g.rows as SpecRow[]) {
          const key = `${typeId}:${g.key}:${r.id}`;
          const text = quantity > 1 && numeric.has(r.id) ? `${quantity} × ${r.value}` : r.value;
          const acc = rows.get(key);
          if (acc) acc.values.push(text);
          else rows.set(key, { groupKey: g.key, id: key, label: r.label, values: [text] });
        }
      }
    }
  }

  const groups: SpecGroup[] = [];
  for (const g of groupOrder) {
    const list: SpecRow[] = [];
    for (const r of rows.values()) {
      if (r.groupKey === g.key) {
        list.push({ id: r.id, label: r.label, value: r.values.join(" + ") });
      }
    }
    if (list.length) groups.push({ key: g.key, name: g.name, rows: list });
  }

  // Строки групп, которых нет в общем порядке: значения атрибутов, снятых с
  // типа детали (buildSpecGroups кладёт их в «Прочее», а у связок всех типов
  // групп может и не быть) — не терять, а дописать в «Прочее».
  const known = new Set(groupOrder.map((g) => g.key));
  const leftover: SpecRow[] = [];
  for (const r of rows.values()) {
    if (!known.has(r.groupKey)) {
      leftover.push({ id: r.id, label: r.label, value: r.values.join(" + ") });
    }
  }
  if (leftover.length) {
    const other = groups.find((g) => g.key === "other");
    if (other) other.rows.push(...leftover);
    else groups.push({ key: "other", name: otherLabel, rows: leftover });
  }
  return groups;
};

/** «Конфигурация»: строки по слотам, детали вне слотов — в конце. */
export const buildPartRows = (
  slots: AssemblySlot[],
  parts: AssemblyPart[],
): PartRow[] => {
  const rows: PartRow[] = [];
  const row = (label: string, p: DistinctPart, i: number): PartRow => ({
    key: `${p.part.typeId?._id ?? ""}:${i}:${p.part.deviceModelId?._id ?? ""}`,
    label,
    title: partTitle(p.part),
    modelId: hasModel(p.part) ? p.part.deviceModelId!._id : null,
    quantity: p.quantity,
  });
  const live = slots.filter((s) => s.typeId?._id);
  const slotIds = new Set(live.map((s) => s.typeId!._id));
  const emit = (typeId: string, label: string) => {
    mergeParts(parts.filter((p) => sameType(p, typeId))).forEach((d, i) =>
      rows.push(row(label, d, i)),
    );
  };
  for (const s of live) emit(s.typeId!._id, s.typeId!.name);
  const extra = distinct(
    parts
      .map((p) => p.typeId?._id)
      .filter((id): id is string => !!id && !slotIds.has(id)),
  );
  for (const id of extra) {
    emit(id, parts.find((p) => p.typeId?._id === id)!.typeId!.name);
  }
  return rows;
};

/** Деталь конкретного устройства (`components[]` ответа client-devices/:id). */
export interface DeviceComponent {
  _id: string;
  deviceModelId?: (AssemblyModel & { deviceTypeId?: AssemblyTypeRef | null }) | null;
  deviceTypeId?: AssemblyTypeRef | null;
  configurationId?: AssemblyConfiguration | null;
  quantity?: number;
  serialNumber?: string | null;
  warrantyExpirationDate?: string | null;
  inventoryNumber?: string | null;
}

/** Детали устройства в виде деталей сборки: тип — модели, иначе собственный. */
export const devicePartsToAssembly = (
  components: DeviceComponent[] | null | undefined,
): AssemblyPart[] =>
  (components ?? []).map((c) => ({
    typeId: c.deviceModelId?.deviceTypeId ?? c.deviceTypeId ?? null,
    deviceModelId: c.deviceModelId ?? null,
    configurationId: c.configurationId ?? null,
    quantity: c.quantity && c.quantity > 0 ? c.quantity : 1,
    deviceId: c._id,
    serialNumber: c.serialNumber ?? null,
    warrantyExpirationDate: c.warrantyExpirationDate ?? null,
    inventoryNumber: c.inventoryNumber ?? null,
  }));

export type DiffTag = "replaced" | "added" | "missing";

export interface DiffRow {
  key: string;
  slotLabel: string;
  typeId: AssemblyTypeRef;
  part: AssemblyPart | null;
  tag: DiffTag | null;
  buildTitle?: string;
}

/** Каждая деталь — по единице на штуку (quantity), в исходном порядке. */
const expandUnits = (parts: AssemblyPart[]): AssemblyPart[] =>
  parts.flatMap((p) => Array.from({ length: qty(p) }, () => p));

/**
 * Сверка деталей устройства со сборкой, по слотам. Единицы одной модели
 * сопоставляются без метки; оставшиеся фактические по порядку занимают
 * оставшиеся единицы сборки («replaced», buildTitle — модель сборки); лишние
 * фактические — «added», недостающие единицы сборки — строки «missing».
 * Без сборки (`buildParts` null) меток нет. Детали вне слотов не включаются.
 * Строка на единицу: схлопывать одинаковые — дело UI.
 */
export const diffWithBuild = (
  slots: AssemblySlot[],
  buildParts: AssemblyPart[] | null,
  deviceParts: AssemblyPart[],
): { rows: DiffRow[]; missingRequired: string[] } => {
  const rows: DiffRow[] = [];
  const missingRequired: string[] = [];
  for (const slot of slots) {
    const type = slot.typeId;
    if (!type?._id) continue;
    const actual = expandUnits(deviceParts.filter((p) => sameType(p, type._id)));
    if (!actual.length && slot.required) missingRequired.push(type.name);
    const tags: (DiffTag | null)[] = actual.map(() => null);
    const titles: (string | undefined)[] = actual.map(() => undefined);
    const missing: AssemblyPart[] = [];
    if (buildParts) {
      const want = expandUnits(buildParts.filter((p) => sameType(p, type._id)));
      const used = new Set<number>();
      const free: number[] = [];
      // Сначала единицы той же модели, каждая занимает одну единицу сборки.
      actual.forEach((a, i) => {
        const id = a.deviceModelId?._id;
        const j = id
          ? want.findIndex((w, k) => !used.has(k) && w.deviceModelId?._id === id)
          : -1;
        if (j >= 0) used.add(j);
        else free.push(i);
      });
      const rest = want.map((_, k) => k).filter((k) => !used.has(k));
      free.forEach((i, n) => {
        if (n < rest.length) {
          tags[i] = "replaced";
          titles[i] = partTitle(want[rest[n]]);
        } else tags[i] = "added";
      });
      for (const k of rest.slice(free.length)) missing.push(want[k]);
    }
    actual.forEach((a, i) =>
      rows.push({
        key: `${type._id}:${i}`,
        slotLabel: type.name,
        typeId: type,
        part: a,
        tag: tags[i],
        ...(titles[i] !== undefined ? { buildTitle: titles[i] } : {}),
      }),
    );
    missing.forEach((m, i) =>
      rows.push({
        key: `${type._id}:missing:${i}`,
        slotLabel: type.name,
        typeId: type,
        part: null,
        tag: "missing",
        buildTitle: partTitle(m),
      }),
    );
  }
  return { rows, missingRequired };
};

export interface WarrantyNote {
  text: string;
  tone: "normal" | "soon" | "expired";
}

const SOON_DAYS = 30;

/** Год/месяц/день: от ISO-строки берётся дата как записана, от Date — локальная. */
const ymd = (v: string | Date): [number, number, number] | null => {
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? null
      : [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  return [v.getFullYear(), v.getMonth() + 1, v.getDate()];
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** «день/дня/дней» по числу. */
const daysWord = (n: number): string => {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return "дней";
  if (m10 === 1) return "день";
  if (m10 >= 2 && m10 <= 4) return "дня";
  return "дней";
};

/** Подпись гарантии; нет даты — null. «Скоро» — не позже 30 дней. */
export const warrantyNote = (
  dateIso: string | null | undefined,
  today: string | Date,
): WarrantyNote | null => {
  const d = dateIso ? ymd(dateIso) : null;
  const t = ymd(today);
  if (!d || !t) return null;
  const date = `${pad(d[2])}.${pad(d[1])}.${d[0]}`;
  const days = Math.round(
    (Date.UTC(d[0], d[1] - 1, d[2]) - Date.UTC(t[0], t[1] - 1, t[2])) / 86400000,
  );
  if (days < 0) return { text: `гарантия истекла ${date}`, tone: "expired" };
  if (days <= SOON_DAYS) {
    return {
      text: `гарантия до ${date} — через ${days} ${daysWord(days)}`,
      tone: "soon",
    };
  }
  return { text: `гарантия до ${date}`, tone: "normal" };
};

/** Строка «Конфигурации» карточки ПК: подряд идущие одинаковые единицы — одной. */
export interface ConfigRow extends DiffRow {
  // Штук в строке (× N)
  units: number;
  // Устройства-детали строки без повторов, в порядке единиц
  devices: AssemblyPart[];
}

const unitKey = (p: AssemblyPart): string =>
  `${p.typeId?._id ?? ""}|${p.deviceModelId?._id ?? ""}|${p.configurationId?._id ?? ""}`;

/**
 * Схлопывает подряд идущие единицы без метки одной модели и конфигурации в
 * одном слоте: «Kingston … × 2». Помеченные (заменена, добавлена, не
 * установлена) и единицы без модели остаются по одной.
 */
export const collapseDiffRows = (rows: DiffRow[]): ConfigRow[] => {
  const out: ConfigRow[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const same =
      last &&
      !r.tag &&
      !last.tag &&
      r.part &&
      last.part &&
      hasModel(r.part) &&
      last.typeId._id === r.typeId._id &&
      unitKey(last.part) === unitKey(r.part);
    if (same) {
      last.units += 1;
      if (!last.devices.some((d) => d.deviceId === r.part!.deviceId)) {
        last.devices.push(r.part!);
      }
      continue;
    }
    out.push({ ...r, units: r.part ? 1 : 0, devices: r.part ? [r.part] : [] });
  }
  return out;
};

/**
 * «Подключено» — дети вне слотов (периферия и т. п.) строками «Конфигурации»:
 * строка на устройство, подпись слота — тип, без меток и сверки.
 */
export const connectedRows = (parts: AssemblyPart[]): ConfigRow[] =>
  parts.map((p) => {
    const typeId = p.typeId ?? { _id: "", name: "Устройство" };
    return {
      key: `connected:${p.deviceId ?? ""}`,
      slotLabel: typeId.name,
      typeId,
      part: p,
      tag: null,
      units: qty(p),
      devices: [p],
    };
  });
