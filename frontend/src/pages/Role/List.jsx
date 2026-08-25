import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import { api, ApiError } from "@/lib/api";
import useToastStore from "@/store/toast-store";

import ListWrapper from "@/components/app/ListWrapper";
import Forbidden from "../../components/Error/403";
import { useCan } from "../../store/authed-user";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";

import useRolesFilterStore from "../../store/lists/roles";
import RoleList from "../../components/Role/List";
import RoleGaps from "../../components/Role/Gaps";
import { usePermissionOptions } from "../../components/Role/permission-options";

/**
 * Роли — справочник, поэтому отдельная страница в «Администрировании», рядом с
 * категориями, регламентами и услугами: все каталоги системы лежат так. В
 * «Настройках системы» ей не место — там панели переключателей установки.
 *
 * Каркас — `ListWrapper`, как у остальных справочников: заголовок со счётчиком,
 * поиск, сортировка, Sheet-фильтр и шторка форм. Своя вёрстка здесь однажды уже
 * дала двойной заголовок и двойные отступы.
 */
const RolesPage = () => {
  const can = useCan();
  const permissionOptions = usePermissionOptions();
  const location = useLocation();
  const filterStore = useRolesFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие и закрытие шторки — тоже
  // навигация, и рефетч в этот момент дёргал бы список под ней.
  useEffect(() => {
    if (location.pathname === "/roles") {
      filterStore.fetch();
    }
  }, [location.key]);

  if (!can({ role: ["read"] })) {
    return <Forbidden />;
  }

  const selected = filterStore.permissions || [];

  const setPermissions = (values) => {
    filterStore.updateFilter({ ...filterStore, permissions: values || [] });
    filterStore.applyFilter();
  };

  /**
   * Фасет прав живёт В СТРОКЕ ИНСТРУМЕНТОВ, а не за кнопкой «Фильтр»: у
   * каталога ролей это ЕДИНСТВЕННОЕ условие, и прятать единственное условие
   * в шторку значит прятать сам смысл экрана — «у кого есть вот это право».
   * Шторка нужна там, где условий много и они не помещаются в ряд.
   */
  const toolbar = (
    <ChipMultiCombobox
      placeholder="Права"
      searchPlaceholder="Найти право…"
      countLabel={(count) => `Права: ${count}`}
      value={selected}
      options={permissionOptions}
      onChange={setPermissions}
    />
  );
  const activeFilters = selected.map((key) => ({
    key,
    label:
      permissionOptions.find((option) => option.value === key)?.label ?? key,
    onRemove: () => setPermissions(selected.filter((item) => item !== key)),
  }));

  return (
    <ListWrapper
      title={() => "Роли"}
      filterStore={filterStore}
      toolbar={toolbar}
      activeFilters={activeFilters}
      hasActiveQuery={selected.length > 0 || Boolean(filterStore.searchTerm)}
      addLabel="Новая роль"
      searchPlaceholder="Поиск по названию"
      emptyTitle="Ролей пока нет"
      emptyHint="Заведите первую — и назначайте её людям вместо россыпи галочек."
      // Дыры каталога — ПОД списком, а не над ним: сначала то, что есть,
      // потом то, чего не хватает.
      belowList={<RoleGaps gaps={filterStore.gaps} />}
    >
      <RoleList roles={filterStore.filteredList || []} />
    </ListWrapper>
  );
};

export default RolesPage;

export function loader() {
  document.title = "Роли";
  return null;
}

/**
 * Удаление приходит из «⋯» строки: `DeleteDialog` шлёт intent=delete с ключом
 * роли на action текущего маршрута. Последствие («снята у N чел.») называет
 * сервер — здесь оно только доносится тостом.
 */
export async function action({ request }) {
  const data = await request.formData();
  if (data.get("intent") !== "delete") return null;

  try {
    const result = await api("/api/roles/" + data.get("id"), {
      method: "DELETE",
    });
    useToastStore
      .getState()
      .showToast(
        "success",
        result.affected?.total
          ? `Роль удалена, снята у ${result.affected.total} чел.`
          : "Роль удалена",
      );
  } catch (failure) {
    useToastStore
      .getState()
      .showToast(
        "danger",
        failure instanceof ApiError
          ? failure.message
          : "Не удалось удалить роль",
      );
  }

  return redirect("/roles");
}
