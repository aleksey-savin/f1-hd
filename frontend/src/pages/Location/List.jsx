import { useContext, useEffect, useMemo, useState } from "react";
import {
  Link,
  Outlet,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigate,
} from "react-router";

import {
  RiAddFill,
  RiCloseLine,
  RiFilter3Line,
  RiMapPinLine,
} from "react-icons/ri";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import ChipCombobox from "@/components/app/ChipCombobox";
import FilterChip from "@/components/app/FilterChip";
import FormSheet from "@/components/app/FormSheet";
import SearchBar from "@/components/app/SearchBar";
import Spinner from "@/components/app/Spinner";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { InsideOverlayContext } from "@/components/app/overlay-context";

import Tree from "../../components/Location/Tree";
import PreviewSheet from "../../components/Location/PreviewSheet";
import LocationFilter from "../../components/Location/Filter";
import { TYPE_LABEL } from "../../components/Location/type-meta";
import useLocationFilterStore from "../../store/lists/locations";
import useMobileFilterOffcanvasStore from "../../store/mobile-filter-offcanvas";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const TYPE_ORDER = { building: 0, floor: 1, room: 2, workplace: 3, storage: 4 };

// Список расположений (мигрирован): дерево выбранной компании; клик по
// строке — предпросмотр в шторке справа, оттуда — карточка. Компания —
// обязательный контекст (чип без сброса), «Рабочие места» — чип-переключатель
// (по умолчанию РМ скрыты — их много).
const LocationList = () => {
  const appLocation = useLocation();
  const navigate = useNavigate();
  const { companies = [] } = useLoaderData();
  const actionData = useActionData();
  const filterStore = useLocationFilterStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const authedUser = useContext(AuthedUserContext);

  const [selectedId, setSelectedId] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);

  const selectedCompanyId = filterStore.selectedCompanyIds[0] || null;

  // Применённые Sheet-фасеты → снимаемые бейджи (компания и «Рабочие места»
  // остаются чипами на панели, тут не дублируются).
  const activeFilters = [
    ...(filterStore.typeFilters || []).map((type) => ({
      key: `type-${type}`,
      label: `Тип: ${TYPE_LABEL[type] || type}`,
      onRemove: () =>
        filterStore.updateFilter({
          typeFilters: filterStore.typeFilters.filter((t) => t !== type),
        }),
    })),
    filterStore.status === "active" && {
      key: "status",
      label: "Активные",
      onRemove: () => filterStore.updateFilter({ status: "all" }),
    },
    filterStore.status === "inactive" && {
      key: "status",
      label: "Отключённые",
      onRemove: () => filterStore.updateFilter({ status: "all" }),
    },
    filterStore.publicOnly && {
      key: "public",
      label: "Общедоступные",
      onRemove: () => filterStore.updateFilter({ publicOnly: false }),
    },
    filterStore.subdivision && {
      key: "subdivision",
      label: `Подразделение: ${filterStore.subdivision.name}`,
      onRemove: () => filterStore.updateFilter({ subdivision: null }),
    },
  ].filter(Boolean);
  const hasActiveFilters = activeFilters.length > 0;

  const companyOptions = useMemo(
    () =>
      [...companies]
        .sort((a, b) =>
          (a.alias || a.fullTitle || "").localeCompare(
            b.alias || b.fullTitle || "",
            "ru",
          ),
        )
        .map((company) => ({
          value: company._id,
          label: company.alias || company.fullTitle,
        })),
    [companies],
  );

  const selectCompany = (companyId) => {
    if (!companyId) return;
    setSelectedId(null);
    // Подразделение привязано к компании — сбрасываем, чтобы фасет из прежней
    // компании не фильтровал новую в ноль
    if (filterStore.subdivision) filterStore.updateFilter({ subdivision: null });
    filterStore.setSelectedCompanies([companyId]);
    filterStore.fetch(companyId);
    // Выбор компании живёт в URL — deep-link и перезагрузка возвращают её же
    const url = new URL(window.location);
    url.searchParams.set("companyIds", companyId);
    window.history.replaceState({}, "", url.pathname + url.search);
  };

  // Начальная компания: из URL → компания пользователя → первая по алфавиту.
  useEffect(() => {
    if (selectedCompanyId || companyOptions.length === 0) return;
    const urlCompanyId = new URLSearchParams(window.location.search)
      .get("companyIds")
      ?.split(",")
      .filter(Boolean)[0];
    const userCompanyId = authedUser.company?._id;
    const isKnown = (id) =>
      id && companyOptions.some((option) => String(option.value) === String(id));
    selectCompany(
      (isKnown(urlCompanyId) && urlCompanyId) ||
        (isKnown(userCompanyId) && userCompanyId) ||
        companyOptions[0].value,
    );
  }, [companyOptions, selectedCompanyId]);

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Перечитываем при возврате к списку (закрытие формы — тоже навигация);
  // зависимость — location.key: redirect после удаления ведёт на тот же
  // pathname. Только на самом списке, чтобы не дёргать под шторкой.
  useEffect(() => {
    if (
      appLocation.pathname === "/inventory/locations" &&
      selectedCompanyId
    ) {
      filterStore.fetch();
    }
  }, [appLocation.key]);

  // Тосты действий (удаление из предпросмотра)
  useEffect(() => {
    if (actionData?.error) showToast("danger", actionData.message);
    if (actionData?.deleted) {
      showToast("success", "Расположение удалено");
      filterStore.fetch();
    }
  }, [actionData, showToast]);

  const originalList = filterStore.originalList || [];
  const filteredList = filterStore.filteredList || [];

  // Узел предпросмотра — из полного набора; исчез после обновления — закрываем
  const byId = useMemo(
    () => new Map(originalList.map((item) => [String(item._id), item])),
    [originalList],
  );
  const selectedNode = selectedId ? byId.get(String(selectedId)) || null : null;
  useEffect(() => {
    if (selectedId && originalList.length > 0 && !byId.has(String(selectedId))) {
      setSelectedId(null);
    }
  }, [byId, selectedId, originalList.length]);

  // Предки (root → родитель) для крошек шторки.
  const ancestors = useMemo(() => {
    if (!selectedNode) return [];
    const out = [];
    let pid = selectedNode.parent?._id || selectedNode.parent;
    let guard = 0;
    while (pid && guard < 8) {
      const parent = byId.get(String(pid));
      if (!parent) break;
      out.unshift(parent);
      pid = parent.parent?._id || parent.parent;
      guard += 1;
    }
    return out;
  }, [selectedNode, byId]);

  // Вложенные для шторки — из ПОЛНОГО набора: скрытые фильтром рабочие места
  // в предпросмотре объекта всё равно видны.
  const childNodes = useMemo(() => {
    if (!selectedNode) return [];
    return originalList
      .filter(
        (item) =>
          String(item.parent?._id || item.parent || "") ===
          String(selectedNode._id),
      )
      .sort(
        (a, b) =>
          (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) ||
          (a.name || "").localeCompare(b.name || "", "ru"),
      );
  }, [selectedNode, originalList]);

  const noData = originalList.length === 0;
  const filteredEmpty = !noData && filteredList.length === 0;
  const addTo = `add?company=${selectedCompanyId || ""}`;

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-7xl">
      {/* Шапка: заголовок + счётчик; поиск, чип компании (обязательный
          контекст), чип «Рабочие места», «Добавить» */}
      <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-3">
        <div className="tw:flex tw:items-baseline tw:gap-2">
          <h1 className="tw:my-0 tw:text-4xl tw:leading-none tw:font-semibold tw:tracking-tight">
            Расположения
          </h1>
          <span className="tw:text-2xl tw:leading-none tw:font-medium tw:text-faint tw:tabular-nums">
            {filteredList.length}
          </span>
        </div>
        <div className="tw:ms-auto tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
          <SearchBar
            onChange={(event) => filterStore.fullTextSearch(event.target.value)}
            className="tw:w-80 tw:max-md:order-last tw:max-md:w-full"
          />
          {/* Компаний может быть много — комбобокс с поиском */}
          <ChipCombobox
            placeholder="Компания"
            searchPlaceholder="Найти компанию…"
            clearable={false}
            value={selectedCompanyId}
            options={companyOptions}
            onChange={selectCompany}
          />
          <FilterChip
            active={filterStore.showWorkplaces}
            onClick={() =>
              filterStore.setShowWorkplaces(!filterStore.showWorkplaces)
            }
          >
            Рабочие места
          </FilterChip>
          <Button
            variant={hasActiveFilters ? "success" : "outline"}
            size="icon"
            onClick={filterOffcanvas.handleShow}
            title="Фильтр"
            aria-label="Фильтр"
          >
            <RiFilter3Line />
          </Button>
          <Button asChild title="Добавить расположение">
            <Link to={addTo} onClick={offcanvas.setShow}>
              <RiAddFill />
              <span className="tw:max-sm:hidden">Добавить расположение</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Применённые Sheet-фасеты — липкая плашка снимаемых бейджей над
          деревом (компания/«Рабочие места» видны чипами, тут не дублируются) */}
      {hasActiveFilters && (
        <div className="tw:sticky tw:top-14 tw:z-30 tw:mb-3 tw:max-md:top-0">
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:rounded-xl tw:border tw:border-border tw:bg-card/85 tw:px-2.5 tw:py-1.5 tw:backdrop-blur-md">
            <RiFilter3Line
              size={15}
              aria-hidden
              className="tw:ms-1 tw:flex-none tw:text-accent-text"
            />
            {activeFilters.map((appliedFilter) => (
              <button
                key={appliedFilter.key}
                type="button"
                onClick={appliedFilter.onRemove}
                title="Снять фильтр"
                className="tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1 tw:rounded-full tw:border-0 tw:bg-primary/15 tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium tw:text-accent-text tw:outline-none tw:hover:bg-primary/25 tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
              >
                {appliedFilter.label}
                <RiCloseLine size={14} aria-hidden />
              </button>
            ))}
            <Button
              variant="ghost"
              size="xs"
              className="tw:ms-auto"
              onClick={filterStore.resetFilter}
            >
              Сбросить
            </Button>
          </div>
        </div>
      )}

      {noData && filterStore.isLoading && <Spinner />}
      {noData && !filterStore.isLoading && (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card">
          <div className="tw:flex tw:flex-col tw:items-center tw:gap-1.5 tw:px-6 tw:py-16 tw:text-center">
            <RiMapPinLine size={44} aria-hidden className="tw:mb-1 tw:text-faint" />
            <div className="tw:text-lg tw:font-semibold">
              В выбранной компании нет расположений
            </div>
            <p className="tw:my-0 tw:max-w-md tw:text-base tw:text-muted-foreground">
              Добавьте первое — например здание или офис, а внутри — этажи и
              помещения.
            </p>
            <Button asChild className="tw:mt-3">
              <Link to={addTo} onClick={offcanvas.setShow}>
                <RiAddFill /> Добавить расположение
              </Link>
            </Button>
          </div>
        </div>
      )}
      {filteredEmpty && (
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card">
          <div className="tw:px-6 tw:py-10 tw:text-center tw:text-sm tw:text-muted-foreground">
            Ничего не нашлось. Измените запрос, сбросьте фильтры или включите
            «Рабочие места».
          </div>
        </div>
      )}
      {!noData && !filteredEmpty && (
        <Tree
          items={filteredList}
          selectedId={selectedId}
          onSelect={(node) => setSelectedId(node._id)}
        />
      )}

      {/* Sheet-фильтр по основным параметрам (тип/статус/доступность/
          подразделение); UI/Select внутри — на инлайн-меню */}
      <Sheet
        open={filterOffcanvas.isActive}
        onOpenChange={(open) => {
          if (!open) filterOffcanvas.handleClose();
        }}
      >
        <SheetContent side="left" className="tw:w-5/6 tw:max-w-sm">
          <SheetHeader className="tw:border-b tw:border-border">
            <SheetTitle className="tw:text-base">Фильтр</SheetTitle>
          </SheetHeader>
          <div className="tw:flex-1 tw:overflow-y-auto tw:px-4 tw:pb-4">
            <InsideOverlayContext.Provider value={true}>
              <LocationFilter />
            </InsideOverlayContext.Provider>
          </div>
        </SheetContent>
      </Sheet>

      {/* Предпросмотр выбранного узла — шторка справа */}
      <PreviewSheet
        node={selectedNode}
        ancestors={ancestors}
        childNodes={childNodes}
        canManage={authedUser.permissions?.canManageClientDevices}
        onClose={() => setSelectedId(null)}
        onNavigate={(node) => setSelectedId(node._id)}
        onDelete={(node) => {
          setSelectedId(null);
          setDeleteItem({ _id: node._id, title: node.name });
        }}
      />

      <DeleteDialog
        item={deleteItem || { _id: "", title: "" }}
        open={Boolean(deleteItem)}
        onOpenChange={(open) => {
          if (!open) setDeleteItem(null);
        }}
        customDeleteMessage="Расположение будет удалено. С устройствами или вложенными расположениями удалить не дадут."
      />

      {/* Формы add/update — нижняя шторка (как в ListWrapper) */}
      <FormSheet
        open={offcanvas.isActive}
        onOpenChange={(open) => {
          if (!open) {
            navigate(-1);
            offcanvas.setClose();
          }
        }}
      >
        <Outlet />
      </FormSheet>
    </div>
  );
};

export default LocationList;

// Loader: только справочник компаний — расположения выбранной компании
// подтягивает стор (fetch по companyIds).
export const loader = async () => {
  document.title = "Расположения";

  const { token } = getLocalStorageData();

  const companiesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies`,
    { headers: { Authorization: "Bearer " + token } },
  );
  const companies = companiesResponse.ok ? await companiesResponse.json() : [];

  return { companies };
};

export const action = async ({ request }) => {
  const { token } = getLocalStorageData();
  const formData = await request.formData();

  if (formData.get("intent") !== "delete") {
    return { ok: true };
  }
  const id = formData.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    },
  );

  // Расположение с устройствами или вложенными бэкенд не удаляет (400) —
  // показываем тост с его сообщением.
  if ([400, 409].includes(response.status)) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message: body.message || "Не удалось удалить расположение.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return { ok: true, deleted: true };
};
