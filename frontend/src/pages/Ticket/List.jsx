import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";

import { RiCheckboxMultipleLine } from "react-icons/ri";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import { useSheetOpen } from "@/components/app/FormOutlet";
import ListWrapper from "@/components/app/ListWrapper";
import Segmented from "@/components/app/Segmented";
import SelectionBar from "@/components/app/SelectionBar";
import { Button } from "@/components/ui/button";

import BulkActionBar from "../../components/Ticket/BulkActionBar";
import TicketFilter from "../../components/Ticket/Filter";
import QueueStrip from "../../components/Ticket/QueueStrip";
import TicketRow from "../../components/Ticket/Row";
import useListSelection from "../../hooks/use-list-selection";
import usePolling from "../../hooks/use-polling";
import { warm } from "@/store/form-data";
import useTicketFilterStore from "../../store/lists/tickets";
import useToastStore from "../../store/toast-store";
import { queueLabel } from "../../util/ticket-queues";
import { useAuthedUser, useCan } from "@/store/authed-user";

// Список активных заявок. Выборка клиентская (открытых заявок десятки), поэтому
// счётчики очередей считаются по всей выборке и честны.
//
// Клик по строке открывает предпросмотр (шторка справа на десктопе, снизу на
// мобилке) — чаще всего нужно понять, о чём заявка, и связаться, а не открывать
// весь экран; «Открыть заявку» живёт в самой шторке. Выделение — в отдельном
// режиме (hooks/use-list-selection): чекбокс по наведению, кнопка «Выбрать» в
// тулбаре, долгий тап на мобилке.

// Опции фасетов собираем из самой выборки — отдельного каталога тут не нужно.
const facetOptions = (list, extract) => {
  const map = new Map();
  for (const ticket of list) {
    for (const { value, label } of extract(ticket)) {
      if (value && !map.has(value)) map.set(value, { value, label });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
};

const Tickets = () => {
  const location = useLocation();
  const store = useTicketFilterStore();
  const { showToast } = useToastStore();
  const can = useCan();

  const [processing, setProcessing] = useState(false);

  const canSelect = can({ ticket: ["delete"] }) || can({ ticket: ["perform"] });
  const canFilterByResponsible =
    can({ ticket: ["administrate"] }) || can({ ticket: ["readAll"] });

  const selection = useListSelection({
    items: store.filteredList,
    enabled: canSelect,
  });

  // Перечитываем список только на своём адресе: открытие и закрытие шторки
  // формы тоже меняют location, а рефетч в этот момент дёргал строки под
  // выезжающей шторкой (как у остальных списков)
  useEffect(() => {
    if (location.pathname === "/tickets") store.fetchOpened();
  }, [location.key]);

  // Справочники формы — заранее: первое открытие «Новой заявки» и «Изменить»
  // уже не ждёт form-data и список шаблонов
  useEffect(() => {
    warm("/api/tickets/form-data");
    warm("/api/ticket-templates");
  }, []);

  // Фоновое автообновление: пока идёт выбор — пауза, иначе список поехал бы под
  // курсором, а выделение частично протухло; при открытой форме — тоже, чтобы
  // не перетереть ввод
  const sheetOpen = useSheetOpen();
  usePolling(() => store.silentRefresh(), {
    intervalMs: 15000,
    enabled: !selection.isActive && !sheetOpen,
  });

  const companyOptions = useMemo(
    () =>
      facetOptions(store.originalList, (ticket) => [
        {
          value: ticket.company?._id?.toString(),
          label: ticket.company?.alias,
        },
      ]),
    [store.originalList],
  );

  const applicantOptions = useMemo(
    () =>
      facetOptions(store.originalList, (ticket) => [
        {
          value: ticket.applicant?._id?.toString(),
          label:
            `${ticket.applicant?.lastName ?? ""} ${ticket.applicant?.firstName ?? ""}`.trim(),
        },
      ]),
    [store.originalList],
  );

  const categoryOptions = useMemo(
    () =>
      facetOptions(store.originalList, (ticket) => [
        {
          value: ticket.category?._id?.toString(),
          label: ticket.category?.title,
        },
      ]),
    [store.originalList],
  );

  const responsibleOptions = useMemo(
    () =>
      facetOptions(store.originalList, (ticket) =>
        (ticket.responsibles ?? []).map((user) => ({
          value: user._id?.toString(),
          label: `${user.lastName ?? ""} ${user.firstName ?? ""}`.trim(),
        })),
      ),
    [store.originalList],
  );

  const optionLabel = (options, id) =>
    options.find((option) => option.value === id)?.label ?? "выбрано";

  // Плашка применённого не повторяет то, что и так видно на экране: набор
  // «Все | Мои» — сегмент в тулбаре, поиск — в своём поле. Очередь попадает:
  // лента прокручивается, и активный чип может быть за краем.
  const activeFilters = [];
  if (store.queue !== "all") {
    activeFilters.push({
      key: "queue",
      label: `Очередь: ${queueLabel(store.queue)}`,
      onRemove: () => store.updateFilter({ queue: "all" }),
    });
  }
  const facetBadge = (key, options, one, many) => {
    if (!store[key].length) return;
    activeFilters.push({
      key,
      label:
        store[key].length === 1
          ? `${one}: ${optionLabel(options, store[key][0])}`
          : `${many}: ${store[key].length}`,
      onRemove: () => store.updateFilter({ [key]: [] }),
    });
  };
  facetBadge("companies", companyOptions, "Компания", "Компании");
  facetBadge("applicants", applicantOptions, "Инициатор", "Инициаторы");
  facetBadge(
    "responsibles",
    responsibleOptions,
    "Ответственный",
    "Ответственные",
  );
  facetBadge("categories", categoryOptions, "Категория", "Категории");
  if (store.states.length) {
    activeFilters.push({
      key: "states",
      label:
        store.states.length === 1
          ? `Состояние: ${store.states[0]}`
          : `Состояний: ${store.states.length}`,
      onRemove: () => store.updateFilter({ states: [] }),
    });
  }
  if (store.createdFrom || store.createdTo) {
    const day = (value) => value.split("-").reverse().join(".");
    activeFilters.push({
      key: "created",
      label:
        store.createdFrom && store.createdTo
          ? `Создана: ${day(store.createdFrom)} – ${day(store.createdTo)}`
          : store.createdFrom
            ? `Создана с ${day(store.createdFrom)}`
            : `Создана по ${day(store.createdTo)}`,
      onRemove: () => store.updateFilter({ createdFrom: "", createdTo: "" }),
    });
  }
  const valueBadge = (key, label) => {
    if (store[key] === "any") return;
    activeFilters.push({
      key,
      label,
      onRemove: () => store.updateFilter({ [key]: "any" }),
    });
  };
  valueBadge(
    "comments",
    store.comments === "present" ? "Есть комментарии" : "Без ответа",
  );
  valueBadge(
    "scheduledWorks",
    store.scheduledWorks === "present"
      ? "Работы запланированы"
      : "Работы не запланированы",
  );
  valueBadge(
    "routineTask",
    store.routineTask === "present"
      ? "Только регламентные"
      : "Без регламентных",
  );

  const toolbar = (
    <>
      {canFilterByResponsible && (
        <Segmented
          ariaLabel="Набор заявок"
          options={[
            { value: "all", label: "Все" },
            { value: "mine", label: "Мои" },
          ]}
          value={store.iAmResponsible ? "mine" : "all"}
          onChange={(value) =>
            store.updateFilter({ iAmResponsible: value === "mine" })
          }
        />
      )}
      <span className="hidden md:contents">
        <ChipMultiCombobox
          placeholder="Компании"
          searchPlaceholder="Найти компанию…"
          countLabel={(count) => `Компании: ${count}`}
          value={store.companies}
          options={companyOptions}
          onChange={(value) => store.updateFilter({ companies: value })}
        />
      </span>
      {canSelect && !selection.isActive && (
        <Button
          variant="outline"
          size="icon"
          title="Выбрать несколько"
          aria-label="Выбрать несколько заявок"
          onClick={() => selection.enter()}
        >
          <RiCheckboxMultipleLine />
        </Button>
      )}
    </>
  );

  // Общий запрос массового действия: POST + обновление списка. Сетевые сбои не
  // роняем — показываем тост, список перечитываем в любом случае.
  const bulkRequest = async (url, body, successMessage) => {
    setProcessing(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}${url}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      showToast("success", successMessage);
    } catch (error) {
      console.error("Ошибка массового действия:", error);
      showToast("danger", "Не удалось выполнить действие. Попробуйте ещё раз.");
    } finally {
      setProcessing(false);
      // Тихое обновление: список не пропадает, выделение сохраняется, а
      // исчезнувшие заявки хук сам уберёт из выбора.
      await store.silentRefresh();
    }
  };

  const ids = selection.selectedIds;
  const selectedItems = store.filteredList.filter((ticket) =>
    selection.isSelected(ticket._id),
  );

  return (
    <>
      <ListWrapper
        title={() => "Заявки"}
        filterStore={store}
        filter={
          <TicketFilter
            companyOptions={companyOptions}
            applicantOptions={applicantOptions}
            responsibleOptions={responsibleOptions}
            categoryOptions={categoryOptions}
          />
        }
        filterActive={activeFilters.length > 0}
        activeFilters={activeFilters}
        toolbar={toolbar}
        defaultSearchValue={store.searchTerm}
        addRoute="/tickets/add"
        addLabel="Новая заявка"
        // Та же ширина, что у шторки карточки: одна форма не может быть
        // 672 со списка и 896 с карточки
        emptyTitle="Открытых заявок нет"
        emptyHint="Всё разобрано. Закрытые заявки лежат в архиве."
        emptyAction={
          <Button asChild variant="ghost">
            <Link to="/archive">Открыть архив</Link>
          </Button>
        }
        selection={
          selection.isActive ? (
            <SelectionBar
              count={selection.count}
              total={selection.total}
              allSelected={selection.allSelected}
              someSelected={selection.someSelected}
              onToggleAll={
                selection.allSelected
                  ? selection.clearSelection
                  : selection.selectAll
              }
              onSelectAll={selection.selectAll}
              onExit={selection.exit}
            />
          ) : undefined
        }
        topContent={
          <>
            {/* Лента очередей — в topContent, а не aboveList: она обязана быть
              видна и когда очередь отфильтровала список в ноль, иначе из пустой
              очереди некуда переключиться */}
            <QueueStrip
              value={store.queue}
              counts={store.queueCounts}
              onChange={(queue) => store.updateFilter({ queue })}
            />
          </>
        }
      >
        {store.filteredList.map((ticket) => (
          <TicketRow
            key={ticket._id}
            ticket={ticket}
            selectable={canSelect}
            selectionActive={selection.isActive}
            isSelected={selection.isSelected(ticket._id)}
            onToggle={selection.toggle}
            pressProps={selection.pressProps(ticket._id)}
            consumeSuppressedClick={selection.consumeSuppressedClick}
            canEdit={can({ ticket: ["update"] })}
            canDelete={can({ ticket: ["delete"] })}
          />
        ))}
      </ListWrapper>

      {/* Плавающая панель — соседка списка, а не его содержимое: она обязана
          оставаться на экране и когда очередь отфильтровала всё в ноль */}
      <BulkActionBar
        selectionActive={selection.isActive}
        selectedItems={selectedItems}
        isLoading={processing || store.isLoading}
        onTakeToWork={({ takeOver }) =>
          bulkRequest(
            "/api/tickets/take-to-work-multiple",
            { ids, takeOver },
            "Заявки приняты в работу",
          )
        }
        onComment={({ content }) =>
          bulkRequest(
            "/api/comments/add-multiple",
            { ids, content },
            "Комментарий добавлен",
          )
        }
        onAddWorks={(payload) =>
          bulkRequest(
            "/api/works/add",
            { ...payload, tickets: ids },
            "Работы добавлены",
          )
        }
        onClose={({ closingComment }) =>
          bulkRequest(
            "/api/tickets/close-multiple",
            { ids, closingComment },
            "Заявки закрыты",
          )
        }
        onDelete={() =>
          bulkRequest("/api/tickets/delete-multiple", { ids }, "Заявки удалены")
        }
      />
    </>
  );
};

// У клиента списка заявок нет — ни в меню, ни в таб-баре (см. menu.js): на
// вопрос «что с моими заявками» ему отвечает блок «Мои заявки» на главной,
// закрытые — «Архив». Прямой адрес (старая закладка) ведёт туда же. Редирект в
// обёртке, а не в теле страницы: до её хуков ранний return невозможен.
const TicketsPage = () => {
  const { isEndUser } = useAuthedUser();
  return isEndUser ? <Navigate to="/dashboard" replace /> : <Tickets />;
};

export default TicketsPage;

export async function loader() {
  document.title = "Заявки";
  return null;
}
