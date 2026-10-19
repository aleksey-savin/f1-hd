import { useEffect, useMemo, useRef, useState } from "react";
import { RiAddLine } from "react-icons/ri";

import { specSummary } from "@/components/app/spec-sheet";
import { load } from "@/store/form-data";
import { idOf, needsConfiguration } from "./part-models";

// Выбор модели детали по слоту — React-часть, общая у формы сборки и шага
// «Комплектующие» мастера устройства: модели каталога по типу и ленивая
// загрузка конфигураций модели (чистая часть — part-models.ts).

// «Ещё <тип>» — ссылка-кнопка добавления строки в слот «несколько»
export const AddLink = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-accent-text hover:underline"
  >
    <RiAddLine size={15} /> {children}
  </button>
);

/** Модели каталога по id и по типу комплектующей. */
export const useModelIndex = (models) =>
  useMemo(() => {
    const byId = new Map();
    const byType = new Map();
    for (const model of models || []) {
      byId.set(model._id, model);
      const typeId = idOf(model.deviceTypeId);
      if (!typeId) continue;
      byType.set(typeId, [...(byType.get(typeId) || []), model]);
    }
    return { byId, byType };
  }, [models]);

const configsPath = (modelId) =>
  `/api/inventory/device-configurations/model/${modelId}`;
const linksPath = (typeId) =>
  `/api/inventory/device-type-attributes/type/${typeId}`;

/**
 * Опции конфигураций моделей строк `{modelId}` — только у моделей, где их
 * больше одной. Лениво, по мере выбора модели; кэш по id модели. Значение:
 * undefined — грузится, null — не загрузилось, иначе массив опций. Сбой не
 * запоминается: любой следующий выбор в строках (хоть та же модель ещё раз)
 * спросит снова — поэтому зависимость именно `rows`, а не набор id.
 */
export const useModelConfigurations = (rows, modelById) => {
  const [configsByModel, setConfigsByModel] = useState({});
  const requested = useRef(new Set());
  useEffect(() => {
    const multiConfigIds = new Set(
      rows
        .map((row) => row.modelId)
        .filter((id) => id && needsConfiguration(modelById.get(id))),
    );
    for (const modelId of multiConfigIds) {
      if (requested.current.has(modelId)) continue;
      requested.current.add(modelId);
      // Повтор после сбоя — снова «загрузка», а не пустой список
      setConfigsByModel((prev) => {
        if (prev[modelId] !== null) return prev;
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
      const typeId = idOf(modelById.get(modelId)?.deviceTypeId);
      Promise.all([
        load(configsPath(modelId)),
        // Связки типа — порядок и единицы в подписи конфигурации
        typeId ? load(linksPath(typeId)).catch(() => []) : [],
      ])
        .then(([configs, links]) => {
          const list = Array.isArray(configs) ? configs : [];
          const options = list.map((config, index) => ({
            value: config._id,
            label:
              config.name ||
              specSummary(
                Array.isArray(links) ? links : [],
                config.values || [],
              ) ||
              `Конфигурация ${index + 1}`,
          }));
          setConfigsByModel((prev) => ({ ...prev, [modelId]: options }));
        })
        .catch(() => {
          requested.current.delete(modelId);
          setConfigsByModel((prev) => ({ ...prev, [modelId]: null }));
        });
    }
  }, [rows, modelById]);
  return configsByModel;
};
