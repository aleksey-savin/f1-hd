/**
 * Вид характеристик модели/устройства: значения конфигурации, разложенные
 * по группам атрибутов типа. Чистые функции без зависимостей — их читают
 * карточка, форма и тест на node:test.
 *
 * Группы идут по groupId.order, затем по имени (ru); внутри группы строки —
 * по order связки, затем createdAt. Связка без группы (или с битым groupId,
 * не объектом) и значения, чей атрибут снят с типа, уходят в «Прочее».
 */

export interface SpecOption {
  value: string;
  label: string;
}

export interface SpecAttr {
  _id?: string;
  name?: string;
  valueType?: string;
  unit?: string;
  options?: SpecOption[];
}

export interface SpecGroupRef {
  _id: string;
  name: string;
  order?: number;
}

export interface SpecLink {
  _id?: string;
  order?: number;
  createdAt?: string;
  attributeId: SpecAttr | string;
  groupId?: SpecGroupRef | string | null;
}

export interface SpecValue {
  attributeId: SpecAttr | string;
  value?: string | boolean | null;
}

export interface SpecRow {
  id: string;
  label: string;
  value: string;
}

export interface SpecGroup {
  key: string;
  name: string;
  rows: SpecRow[];
}

export interface LinkGroup<L extends SpecLink = SpecLink> {
  key: string;
  name: string;
  links: L[];
}

const collator = new Intl.Collator("ru");

/** Значение multiselect хранится JSON-массивом; не JSON — одно сырое значение. */
export const parseMultiValue = (raw: string): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // не JSON — старое значение одной строкой
  }
  return [raw];
};

export const serializeMultiValue = (values: string[]): string =>
  JSON.stringify(values);

/** Человекочитаемое значение характеристики по типу атрибута. */
export const formatSpecValue = (
  attr: SpecAttr | null | undefined,
  raw: string | boolean | null | undefined,
): string => {
  if (raw === undefined || raw === null || raw === "") return "";
  const type = attr?.valueType;
  if (type === "boolean" || typeof raw === "boolean") {
    return raw === true || raw === "true" ? "да" : "нет";
  }
  const text = String(raw);
  const labelOf = (v: string) =>
    attr?.options?.find((o) => o.value === v)?.label ?? v;
  if (type === "select") return labelOf(text);
  if (type === "multiselect") {
    // Не JSON-массив — показываем как есть, без подмены подписями.
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

const attrOf = (a: SpecAttr | string): SpecAttr | null =>
  typeof a === "object" && a !== null ? a : null;
const idOf = (a: SpecAttr | string): string =>
  (typeof a === "object" && a !== null ? a._id : a) ?? "";
const groupOf = (l: SpecLink): SpecGroupRef | null =>
  typeof l.groupId === "object" && l.groupId !== null ? l.groupId : null;

const byLinkOrder = (a: SpecLink, b: SpecLink) =>
  (a.order ?? 0) - (b.order ?? 0) ||
  String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));

const byGroup = (a: SpecGroupRef, b: SpecGroupRef) =>
  (a.order ?? 0) - (b.order ?? 0) || collator.compare(a.name, b.name);

/**
 * Связки по группам в порядке показа; без группы — последней под otherLabel.
 * Пустых групп не бывает: группируем связки, а не значения.
 */
export const groupLinks = <L extends SpecLink>(
  links: L[],
  otherLabel = "Прочее",
): LinkGroup<L>[] => {
  const groups = new Map<string, { ref: SpecGroupRef; links: L[] }>();
  const rest: L[] = [];
  for (const l of links) {
    const g = groupOf(l);
    if (!g) {
      rest.push(l);
      continue;
    }
    const entry = groups.get(g._id) ?? { ref: g, links: [] };
    entry.links.push(l);
    groups.set(g._id, entry);
  }
  const result: LinkGroup<L>[] = [...groups.values()]
    .sort((a, b) => byGroup(a.ref, b.ref))
    .map((e) => ({
      key: e.ref._id,
      name: e.ref.name,
      links: e.links.sort(byLinkOrder),
    }));
  if (rest.length) {
    result.push({ key: "other", name: otherLabel, links: rest.sort(byLinkOrder) });
  }
  return result;
};

/** Строки спецификации по группам; пустые значения и пустые группы выкинуты. */
export const buildSpecGroups = (
  links: SpecLink[],
  values: SpecValue[],
  { otherLabel = "Прочее" }: { otherLabel?: string } = {},
): SpecGroup[] => {
  const byAttr = new Map<string, SpecValue>();
  for (const v of values) byAttr.set(idOf(v.attributeId), v);

  const seen = new Set<string>();
  const groups: SpecGroup[] = [];
  for (const g of groupLinks(links, otherLabel)) {
    const rows: SpecRow[] = [];
    for (const l of g.links) {
      const id = idOf(l.attributeId);
      const entry = byAttr.get(id);
      if (!entry) continue;
      const meta = attrOf(l.attributeId) ?? attrOf(entry.attributeId);
      const value = formatSpecValue(meta, entry.value);
      if (!value) continue;
      seen.add(id);
      rows.push({ id, label: meta?.name || "Атрибут", value });
    }
    if (rows.length) groups.push({ key: g.key, name: g.name, rows });
  }

  // Значения, чей атрибут снят с типа: в «Прочее», по имени атрибута.
  const orphans: SpecRow[] = [];
  for (const [id, entry] of byAttr) {
    if (seen.has(id) || links.some((l) => idOf(l.attributeId) === id)) continue;
    const meta = attrOf(entry.attributeId);
    const value = formatSpecValue(meta, entry.value);
    if (value) orphans.push({ id, label: meta?.name || "Атрибут", value });
  }
  orphans.sort((a, b) => collator.compare(a.label, b.label));

  if (orphans.length) {
    const other = groups.find((g) => g.key === "other");
    if (other) other.rows.push(...orphans);
    else groups.push({ key: "other", name: otherLabel, rows: orphans });
  }
  return groups;
};

/**
 * Сводка конфигурации — первые `limit` непустых значений через « / »: по
 * порядку связок типа (без оглядки на группы), затем значения атрибутов,
 * снятых с типа. Подпись чипа и шапки конфигурации, хвост метки на
 * карточке устройства.
 */
export const specSummary = (
  links: SpecLink[],
  values: SpecValue[],
  limit = 3,
): string => {
  const byAttr = new Map<string, SpecValue>();
  for (const v of values) byAttr.set(idOf(v.attributeId), v);

  const parts: string[] = [];
  const seen = new Set<string>();
  for (const l of [...links].sort(byLinkOrder)) {
    const id = idOf(l.attributeId);
    const entry = byAttr.get(id);
    if (!entry) continue;
    seen.add(id);
    const meta = attrOf(l.attributeId) ?? attrOf(entry.attributeId);
    const text = formatSpecValue(meta, entry.value);
    if (text) parts.push(text);
  }
  for (const [id, entry] of byAttr) {
    if (seen.has(id)) continue;
    const text = formatSpecValue(attrOf(entry.attributeId), entry.value);
    if (text) parts.push(text);
  }
  return parts.slice(0, limit).join(" / ");
};

/** Две колонки: ceil(n/2) слева. */
export const splitColumns = <T>(rows: T[]): [T[], T[]] => {
  const half = Math.ceil(rows.length / 2);
  return [rows.slice(0, half), rows.slice(half)];
};
