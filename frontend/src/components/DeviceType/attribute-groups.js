import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";
import useToastStore from "../../store/toast-store";

export const ATTRIBUTE_GROUPS_PATH = "/api/inventory/attribute-groups";

// Подпись пункта создания в поле «Группа» обеих форм атрибута типа
export const createGroupLabel = (query) => `Новая группа «${query}»`;

/**
 * Группы атрибутов для поля «Группа» в формах связки (AttributeForm,
 * AttributesAddForm). Список — из кэша форм; новая группа создаётся прямо из
 * поиска и сразу встаёт в список. Ошибку создания (дубль имени — 409)
 * показываем тостом и отдаём null: выбор в поле остаётся прежним.
 */
export const useAttributeGroups = () => {
  const { showToast } = useToastStore();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    load(ATTRIBUTE_GROUPS_PATH)
      .then((data) => {
        if (alive) setGroups(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const createGroup = useCallback(
    async (name) => {
      try {
        const { attributeGroup } = await api(
          `${ATTRIBUTE_GROUPS_PATH}/add`,
          { method: "POST", body: { name } },
        );
        // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
        invalidate("/api/inventory/");
        setGroups((prev) => [...prev, attributeGroup]);
        return attributeGroup;
      } catch (error) {
        showToast("danger", error?.message || "Не удалось создать группу.");
        return null;
      }
    },
    [showToast],
  );

  return { groups, loading, createGroup };
};
