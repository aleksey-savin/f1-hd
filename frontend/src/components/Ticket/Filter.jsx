import { useContext } from "react";

import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import Segmented from "@/components/app/Segmented";
import { Input } from "@/components/ui/input";

import useInitialPrefsStore from "../../store/prefs";
import useTicketFilterStore from "../../store/lists/tickets";
import { AuthedUserContext } from "../../store/authed-user-context";
import Select from "../../UI/Select";

// Sheet-фильтр списка заявок — один для десктопа и мобайла. Здесь живёт всё, что
// трогают редко; набор «Все | Мои» и чип компаний остаются на экране, поля
// «Набор» тут намеренно нет: два места для одного булева пришлось бы
// синхронизировать руками. UI/Select внутри шторки работает через
// InsideOverlayContext (его ставит сам ListWrapper).
//
// Сверху — три быстрых переключателя на три кнопки: у них по три значения, и
// сегмент отвечает быстрее выпадающего списка. Ниже — период и длинные
// мультиселекты.

const ROUTINE_OPTIONS = [
  { value: "any", label: "Все" },
  { value: "present", label: "Только" },
  { value: "absent", label: "Скрыть" },
];

const SCHEDULED_WORKS_OPTIONS = [
  { value: "any", label: "Все" },
  { value: "present", label: "Есть" },
  { value: "absent", label: "Нет" },
];

const COMMENT_OPTIONS = [
  { value: "any", label: "Все" },
  { value: "present", label: "Есть" },
  { value: "silent", label: "Без ответа" },
];

const STATE_OPTIONS = [
  "Новая",
  "Не в работе",
  "В работе",
  "На согласовании",
  "Выполнена",
].map((value) => ({ value, label: value }));

const byIds = (options, ids) =>
  options.filter((option) => ids.includes(option.value));

const toIds = (selected) => (selected || []).map((option) => option.value);

const TicketFilter = ({
  companyOptions = [],
  applicantOptions = [],
  responsibleOptions = [],
  categoryOptions = [],
}) => {
  const { isAdmin, permissions, isEndUser } = useContext(AuthedUserContext);
  const { modules } = useInitialPrefsStore();
  const store = useTicketFilterStore();

  const canSeeResponsiblesFacet =
    isAdmin ||
    permissions.canAdministrateTickets ||
    permissions.canSeeAllTickets;

  return (
    <FilterContainer resetFilterHandler={store.resetFilter}>
      {!isEndUser && (
        <>
          <Field label="Регламентные заявки">
            <Segmented
              ariaLabel="Регламентные заявки"
              options={ROUTINE_OPTIONS}
              value={store.routineTask}
              onChange={(value) => store.updateFilter({ routineTask: value })}
            />
          </Field>

          {modules.timeTracking?.isActive && (
            <Field label="Запланированные работы">
              <Segmented
                ariaLabel="Запланированные работы"
                options={SCHEDULED_WORKS_OPTIONS}
                value={store.scheduledWorks}
                onChange={(value) =>
                  store.updateFilter({ scheduledWorks: value })
                }
              />
            </Field>
          )}

          <Field
            label="Комментарии"
            hint="«Без ответа» — переписки нет вовсе или последняя старше суток"
          >
            <Segmented
              ariaLabel="Комментарии"
              options={COMMENT_OPTIONS}
              value={store.comments}
              onChange={(value) => store.updateFilter({ comments: value })}
            />
          </Field>
        </>
      )}

      <Field label="Создана в период" htmlFor="filter-created-from">
        <div className="tw:grid tw:grid-cols-2 tw:gap-2">
          <Input
            id="filter-created-from"
            type="date"
            aria-label="Начало периода"
            value={store.createdFrom}
            max={store.createdTo || undefined}
            onChange={(event) =>
              store.updateFilter({ createdFrom: event.target.value })
            }
          />
          <Input
            id="filter-created-to"
            type="date"
            aria-label="Конец периода"
            value={store.createdTo}
            min={store.createdFrom || undefined}
            onChange={(event) =>
              store.updateFilter({ createdTo: event.target.value })
            }
          />
        </div>
      </Field>

      <Field label="Компании" htmlFor="filter-companies">
        <Select
          id="filter-companies"
          placeholder="Все компании"
          isMulti
          isClearable
          isSearchable
          value={byIds(companyOptions, store.companies)}
          options={companyOptions}
          onChange={(selected) =>
            store.updateFilter({ companies: toIds(selected) })
          }
        />
      </Field>

      <Field label="Инициаторы" htmlFor="filter-applicants">
        <Select
          id="filter-applicants"
          placeholder="Все инициаторы"
          isMulti
          isClearable
          isSearchable
          value={byIds(applicantOptions, store.applicants)}
          options={applicantOptions}
          onChange={(selected) =>
            store.updateFilter({ applicants: toIds(selected) })
          }
        />
      </Field>

      {canSeeResponsiblesFacet && (
        <Field label="Ответственные" htmlFor="filter-responsibles">
          <Select
            id="filter-responsibles"
            placeholder="Все ответственные"
            isMulti
            isClearable
            isSearchable
            value={byIds(responsibleOptions, store.responsibles)}
            options={responsibleOptions}
            onChange={(selected) =>
              store.updateFilter({ responsibles: toIds(selected) })
            }
          />
        </Field>
      )}

      <Field label="Категории" htmlFor="filter-categories">
        <Select
          id="filter-categories"
          placeholder="Все категории"
          isMulti
          isClearable
          isSearchable
          value={byIds(categoryOptions, store.categories)}
          options={categoryOptions}
          onChange={(selected) =>
            store.updateFilter({ categories: toIds(selected) })
          }
        />
      </Field>

      <Field label="Состояние" htmlFor="filter-states">
        <Select
          id="filter-states"
          placeholder="Любое состояние"
          isMulti
          isClearable
          value={byIds(STATE_OPTIONS, store.states)}
          options={STATE_OPTIONS}
          onChange={(selected) =>
            store.updateFilter({ states: toIds(selected) })
          }
        />
      </Field>
    </FilterContainer>
  );
};

export default TicketFilter;
