// Уровень атрибута каталога: «model» — одно значение на конфигурацию модели,
// «device» — своё у каждого экземпляра. Уровень — свойство самого атрибута
// (backend services/inventory/attributeScope.js); у связки типа без
// populated-атрибута или без scope — модель, прежнее поведение.

export type AttributeScope = "model" | "device";

type ScopedLink = { attributeId?: unknown };

const scopeOf = (link: ScopedLink): AttributeScope => {
  const attr = link?.attributeId;
  return attr && typeof attr === "object" && (attr as { scope?: string }).scope === "device"
    ? "device"
    : "model";
};

/** Связки типа с атрибутами уровня модели (характеристики конфигурации). */
export const modelLinks = <T extends ScopedLink>(links: T[] | null | undefined): T[] =>
  (links ?? []).filter((link) => scopeOf(link) === "model");

/** Связки типа с атрибутами уровня устройства (параметры экземпляра). */
export const deviceLinks = <T extends ScopedLink>(links: T[] | null | undefined): T[] =>
  (links ?? []).filter((link) => scopeOf(link) === "device");

export const SCOPE_OPTIONS: { value: AttributeScope; label: string }[] = [
  { value: "model", label: "У модели" },
  { value: "device", label: "У каждого устройства" },
];
