import { useEffect, useRef } from "react";

import { RiBox3Line } from "react-icons/ri";
import { redirect, useLocation, useSearchParams } from "react-router";

import ListWrapper from "@/components/app/ListWrapper";
import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import Pager from "@/components/app/Pager";
import { DEVICE_STATUS_META } from "@/components/app/device-status";

import ClientDeviceFilter from "../../components/ClientDevice/Filter";
import DeviceRow from "../../components/ClientDevice/DeviceRow";
import FleetStrip from "../../components/ClientDevice/FleetStrip";
import useClientDeviceFilterStore from "../../store/lists/client-devices";
import { plural } from "../../util/plural";
import { useCan } from "@/store/authed-user";

const LIST_PATH = "/inventory/client-devices";

// Пока опции фасетов не приехали, у бейджа нет человеческого имени — и лучше
// многоточие, чем ObjectId: внутренние идентификаторы пользователю не
// показываем никогда.
const labelOf = (options, value) =>
  options.find((option) => option.value === value)?.label || "…";

/**
 * Реестр техники клиентов: строка с жёсткими колонками, лента жизненного цикла
 * парка над списком (она же фильтр по стадии) и серверная выборка — поиск,
 * фасеты, сортировка и страницы по 50 считает бэкенд.
 *
 * Живой статус связи Mikrotik показывается точкой на плитке по состоянию на
 * момент загрузки: постоянного поллинга здесь нет намеренно — за «сейчас»
 * отвечает статус-борд мониторинга, а реестр отвечает за учёт.
 */
const ClientDevices = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const can = useCan();
  const store = useClientDeviceFilterStore();

  // Снятие ?company= меняет адрес и без него бы перезапросило список — этот
  // переход пропускаем (данные уже едут с префильтром).
  const skipNextNavigation = useRef(false);
  const isMountNavigation = useRef(true);

  // Префильтр из query (?company= | ?user=) — ссылки «Вся техника в
  // „Устройствах“» с карточек компании и пользователя. Применяется один раз,
  // параметр снимается из адреса, дальше фасет живёт как обычный.
  useEffect(() => {
    const companyId = searchParams.get("company");
    const userId = searchParams.get("user");
    store.fetchOptions();
    if (companyId || userId) {
      store.applyPrefilter({ companyId, userId });
      skipNextNavigation.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete("company");
      next.delete("user");
      setSearchParams(next, { replace: true });
    } else {
      store.fetch();
    }
    // Только на монтировании: дальше стор перезапрашивает себя сам.
  }, []);

  // Список перечитывается после любой навигации на нём: возврат из шторки
  // формы (создали/изменили) и редирект экшена удаления — он приходит на тот же
  // путь, поэтому следить за одним pathname недостаточно.
  useEffect(() => {
    if (isMountNavigation.current) {
      isMountNavigation.current = false;
      return;
    }
    if (skipNextNavigation.current) {
      skipNextNavigation.current = false;
      return;
    }
    if (location.pathname === LIST_PATH) store.fetch();
  }, [location.key]);

  const { facets, options } = store;
  const activeFilters = [
    ...facets.companies.map((id) => ({
      key: `company-${id}`,
      label: `Компания: ${labelOf(options.companies, id)}`,
      onRemove: () =>
        store.setFacet(
          "companies",
          facets.companies.filter((entry) => entry !== id),
        ),
    })),
    ...facets.locations.map((id) => ({
      key: `location-${id}`,
      label: `Расположение: ${labelOf(options.locations, id)}`,
      onRemove: () =>
        store.setFacet(
          "locations",
          facets.locations.filter((entry) => entry !== id),
        ),
    })),
    ...facets.users.map((id) => ({
      key: `user-${id}`,
      label: `Закреплено за: ${labelOf(options.users, id)}`,
      onRemove: () =>
        store.setFacet(
          "users",
          facets.users.filter((entry) => entry !== id),
        ),
    })),
    ...facets.types.map((id) => ({
      key: `type-${id}`,
      label: `Тип: ${labelOf(options.types, id)}`,
      onRemove: () =>
        store.setFacet(
          "types",
          facets.types.filter((entry) => entry !== id),
        ),
    })),
    ...facets.vendors.map((id) => ({
      key: `vendor-${id}`,
      label: `Производитель: ${labelOf(options.vendors, id)}`,
      onRemove: () =>
        store.setFacet(
          "vendors",
          facets.vendors.filter((entry) => entry !== id),
        ),
    })),
    ...facets.statuses.map((status) => ({
      key: `status-${status}`,
      label: `Статус: ${DEVICE_STATUS_META[status]?.label || status}`,
      onRemove: () => store.toggleStatus(status),
    })),
    ...(facets.noInventory
      ? [
          {
            key: "no-inventory",
            label: "Без инвентарного номера",
            onRemove: () => store.toggleNoInventory(),
          },
        ]
      : []),
    ...(facets.withComponents
      ? [
          {
            key: "with-components",
            label: "С комплектующими",
            onRemove: () => store.toggleComponents(),
          },
        ]
      : []),
  ];

  const hasActiveQuery = Boolean(store.searchTerm) || activeFilters.length > 0;

  return (
    <>
      <ListWrapper
        title={() => "Устройства"}
        count={store.total}
        hasActiveQuery={hasActiveQuery}
        filterStore={store}
        filter={<ClientDeviceFilter />}
        filterActive={activeFilters.length > 0}
        activeFilters={activeFilters}
        toolbar={
          <ChipMultiCombobox
            placeholder="Все компании"
            searchPlaceholder="Найти компанию…"
            countLabel={(count) => `Компании: ${count}`}
            value={facets.companies}
            options={options.companies}
            onChange={(value) => store.setFacet("companies", value)}
          />
        }
        showAddButton={Boolean(can({ device: ["manage"] }))}
        addRoute="add"
        addLabel="Новое устройство"
        // Создание — мастер (lg), правка — плоская форма с рейлом (xl).
        // Одна и та же форма правки одной ширины и здесь, и на карточке.
        topContent={
          <FleetStrip
            statusCounts={store.statusCounts}
            selected={facets.statuses}
            onToggle={store.toggleStatus}
            noInventoryNumber={store.noInventoryNumber}
            noInventoryActive={facets.noInventory}
            onToggleNoInventory={store.toggleNoInventory}
          />
        }
        aboveList={
          // Детали в выдаче — объясняем расхождение: лента парка считает только
          // самостоятельные единицы, а счётчик у заголовка — всё найденное.
          store.componentsCount > 0 && (
            <div className="mb-3 flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <RiBox3Line size={15} aria-hidden className="text-faint" />
              Найдено {store.total} · из них{" "}
              <b className="font-semibold text-foreground">
                {store.componentsCount}{" "}
                {plural(
                  store.componentsCount,
                  "в составе сборки",
                  "в составе сборок",
                  "в составе сборок",
                )}
              </b>
              <span className="text-faint max-md:hidden">
                — лента парка считает только самостоятельные единицы
              </span>
            </div>
          )
        }
        belowList={
          <Pager
            page={store.page}
            pageSize={store.pageSize}
            total={store.total}
            loaded={store.items.length}
            onPage={store.setPage}
            onLoadMore={store.loadMore}
          />
        }
      >
        <div>
          {store.items.map((device) => (
            <DeviceRow key={device._id} device={device} />
          ))}
        </div>
      </ListWrapper>
    </>
  );
};

export default ClientDevices;

export async function loader() {
  document.title = "Устройства";

  return null;
}

export async function action({ request }) {
  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/delete/${id}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return redirect("/inventory/client-devices");
}
