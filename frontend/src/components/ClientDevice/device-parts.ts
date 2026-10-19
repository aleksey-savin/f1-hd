/**
 * Шаг «Комплектующие» мастера устройства — чистая часть: строки по единицам
 * (из сборки или вручную), гарантия «+N мес», сводка сборки и тело `parts`.
 * Каждая строка — одна физическая деталь: станет отдельным устройством.
 */

import {
  idOf,
  lowerFirstWord,
  modelGoneOf,
  type ModelGone,
  type PickerModel,
} from "../DeviceBuild/part-models.ts";
import {
  buildPartRows,
  keySpecsLine,
  type AssemblyKeySpec,
  type AssemblyPart,
  type AssemblySlot,
} from "../app/assembly-specs.ts";
import { plural } from "../../util/plural.js";

type Ref = { _id: string } | string | null | undefined;

export interface PartUnit {
  key: string;
  typeId: string;
  modelId: string | null;
  configId: string | null;
  // Модель из сборки не подставилась: удалена или другого типа
  modelGone: ModelGone;
  serialNumber: string;
  warrantyExpirationDate: string;
  // Гарантия выбрана чипом «+N мес»: дата пересчитывается от итоговой даты
  // покупки (своей, ПК или сегодня); выбранная руками — null
  warrantyMonths: number | null;
  // «Закупка как у ПК»: выключено — своя дата покупки и поставщик
  samePurchase: boolean;
  purchasedAt: string;
  supplierId: string;
}

export interface UnitSlot {
  typeId: { _id: string; name: string } | null;
  required?: boolean;
  multiple?: boolean;
}

export interface BuildPart {
  typeId: Ref;
  deviceModelId: PickerModel | null;
  configurationId?: { _id: string; deletedAt?: string | null } | null;
  quantity?: number;
}

// Ключ строки — локальный: строка без модели своего id не имеет
let unitSeq = 0;

export const emptyUnit = (typeId: string): PartUnit => ({
  key: `unit-${++unitSeq}`,
  typeId,
  modelId: null,
  configId: null,
  modelGone: null,
  serialNumber: "",
  warrantyExpirationDate: "",
  warrantyMonths: null,
  samePurchase: true,
  purchasedAt: "",
  supplierId: "",
});

const liveSlots = (slots: UnitSlot[]) => slots.filter((slot) => slot.typeId);

/** «Без сборки — детали вручную»: по пустой строке на слот, в порядке слотов (как из сборки). */
export const manualUnits = (slots: UnitSlot[]): PartUnit[] =>
  liveSlots(slots).map((slot) => emptyUnit(slot.typeId!._id));

/**
 * Из сборки: деталь сборки разворачивается в `quantity` строк, слот без
 * деталей сборки — одна пустая строка. Удалённая или сменившая тип модель
 * не подставляется: строка пуста, но знает почему (сервер её не примет).
 */
export const unitsFromBuild = (
  slots: UnitSlot[],
  parts: BuildPart[],
): PartUnit[] => {
  const units: PartUnit[] = [];
  for (const slot of liveSlots(slots)) {
    const typeId = slot.typeId!._id;
    const own = parts.filter((part) => idOf(part.typeId) === typeId);
    if (own.length === 0) {
      units.push(emptyUnit(typeId));
      continue;
    }
    for (const part of own) {
      const gone = modelGoneOf(part.deviceModelId, typeId);
      const config = part.configurationId;
      const count =
        slot.multiple && (part.quantity || 0) > 0 ? part.quantity! : 1;
      for (let i = 0; i < count; i += 1) {
        units.push({
          ...emptyUnit(typeId),
          modelId: gone ? null : part.deviceModelId!._id,
          configId: !gone && config && !config.deletedAt ? config._id : null,
          modelGone: gone,
        });
      }
    }
  }
  return units;
};

/** «1 из 2» — у строк слота, где их больше одной; иначе нет подписи. */
export const unitPosition = (
  units: PartUnit[],
  unit: PartUnit,
): string | null => {
  const siblings = units.filter((other) => other.typeId === unit.typeId);
  if (siblings.length < 2) return null;
  return `${siblings.indexOf(unit) + 1} из ${siblings.length}`;
};

/** Новая пустая строка слота — сразу после его последней строки. */
export const insertUnit = (units: PartUnit[], typeId: string): PartUnit[] => {
  let last = -1;
  units.forEach((unit, index) => {
    if (unit.typeId === typeId) last = index;
  });
  const next = [...units];
  next.splice(last + 1, 0, emptyUnit(typeId));
  return next;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * «2026-10-19» + N месяцев → «2028-10-19». Конец месяца прижимается
 * (31 января + 1 мес → 28/29 февраля). Календарные дни — без часовых поясов.
 */
export const addMonthsToDay = (dayKey: string, months: number): string => {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`;
};

export const WARRANTY_MONTHS = [12, 24, 36];

/**
 * От какой даты считаются «12 / 24 / 36 мес»: своя дата покупки (закупка не
 * как у ПК), иначе дата покупки ПК с шага «Закупка», иначе сегодня.
 */
export const warrantyBase = (
  unit: PartUnit,
  pcPurchasedAt: string,
  today: string,
): string => (unit.samePurchase ? pcPurchasedAt : unit.purchasedAt) || today;

/**
 * Активный чип: выбранный чипом (месяцы хранятся в строке), иначе тот, чьё
 * «+N мес» совпадает с «Гарантия до»; иначе null.
 */
export const activeWarrantyMonths = (
  unit: PartUnit,
  base: string,
): number | null => {
  if (unit.warrantyMonths) return unit.warrantyMonths;
  return unit.warrantyExpirationDate
    ? (WARRANTY_MONTHS.find(
        (months) =>
          addMonthsToDay(base, months) === unit.warrantyExpirationDate,
      ) ?? null)
    : null;
};

/** «Гарантия до» строки: выбранная чипом — от текущей даты покупки, иначе как задана. */
export const unitWarranty = (unit: PartUnit, base: string): string =>
  unit.warrantyMonths
    ? addMonthsToDay(base, unit.warrantyMonths)
    : unit.warrantyExpirationDate;

export interface PartBody {
  typeId: string;
  deviceModelId: string;
  configurationId?: string;
  serialNumber?: string;
  warrantyExpirationDate?: string;
  purchasedAt?: string;
  supplierId?: string;
}

/**
 * Тело `parts`: строки без модели не уходят. Закупка — всё или ничего:
 * «как у ПК» — ни даты, ни поставщика; своя — оба поля как заданы. Гарантия,
 * выбранная чипом, считается от итоговой даты покупки: своей, ПК с шага
 * «Закупка» или сегодня.
 */
export const partsBody = (
  units: PartUnit[],
  { pcPurchasedAt = "", today = "" }: { pcPurchasedAt?: string; today?: string } = {},
): PartBody[] =>
  units
    .filter((unit) => unit.modelId)
    .map((unit) => {
      const body: PartBody = {
        typeId: unit.typeId,
        deviceModelId: unit.modelId!,
      };
      if (unit.configId) body.configurationId = unit.configId;
      const serial = unit.serialNumber.trim();
      if (serial) body.serialNumber = serial;
      const warranty = unitWarranty(
        unit,
        warrantyBase(unit, pcPurchasedAt, today),
      );
      if (warranty) body.warrantyExpirationDate = warranty;
      if (!unit.samePurchase) {
        body.purchasedAt = unit.purchasedAt;
        body.supplierId = unit.supplierId;
      }
      return body;
    });

export const partsCountLabel = (n: number): string =>
  `${n} ${plural(n, "деталь", "детали", "деталей")}`;

/** «8 деталей станут отдельными устройствами в составе этого ПК.» */
export const partsStepLead = (n: number): string =>
  n === 1
    ? "1 деталь станет отдельным устройством в составе этого ПК."
    : `${partsCountLabel(n)} станут отдельными устройствами в составе этого ПК.`;

/**
 * Карточка сборки под полем «Сборка»: ключевые характеристики и
 * «8 деталей: процессор, 2 × оперативная память, …» (типы в порядке слотов).
 */
export const buildSummary = (
  assembly: { slots: AssemblySlot[]; keySpecs: AssemblyKeySpec[] },
  parts: AssemblyPart[],
): { keySpecs: string; composition: string } => {
  const byType = new Map<string, number>();
  for (const row of buildPartRows(assembly.slots, parts)) {
    byType.set(row.label, (byType.get(row.label) || 0) + row.quantity);
  }
  const total = [...byType.values()].reduce((sum, n) => sum + n, 0);
  const list = [...byType.entries()]
    .map(([label, n]) => `${n > 1 ? `${n} × ` : ""}${lowerFirstWord(label)}`)
    .join(", ");
  return {
    keySpecs: keySpecsLine(assembly.keySpecs, parts, assembly.slots),
    composition: total ? `${partsCountLabel(total)}: ${list}` : "",
  };
};
