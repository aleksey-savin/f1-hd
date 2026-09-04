import { useContext } from "react";

import DateRangeField from "@/components/app/DateRangeField";
import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import Segmented from "@/components/app/Segmented";

import useInitialPrefsStore from "../../store/prefs";
import useTicketFilterStore from "../../store/lists/tickets";
import { AuthedUserContext } from "../../store/authed-user-context";
import { MultiCombobox } from "@/components/app/Combobox";
import { useCan } from "@/store/authed-user";

// Sheet-фильтр списка заявок — один для десктопа и мобайла. Здесь живёт всё, что
// трогают редко; набор «Все | Мои» и чип компаний остаются на экране, поля
// «Набор» тут намеренно нет: два места для одного булева пришлось бы
// синхронизировать руками.
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

const TicketFilter = ({
  companyOptions = [],
  applicantOptions = [],
  responsibleOptions = [],
  categoryOptions = [],
}) => {
  const { isEndUser } = useContext(AuthedUserContext);
  const can = useCan();
  const { modules } = useInitialPrefsStore();
  const store = useTicketFilterStore();

  const canSeeResponsiblesFacet =
    can({ ticket: ["administrate"] }) || can({ ticket: ["readAll"] });

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

      <Field label="Создана в период" htmlFor="filter-created">
        <DateRangeField
          id="filter-created"
          value={{ from: store.createdFrom, to: store.createdTo }}
          onChange={({ from, to }) =>
            store.updateFilter({ createdFrom: from, createdTo: to })
          }
        />
      </Field>

      <Field label="Компании" htmlFor="filter-companies">
        <MultiCombobox
          id="filter-companies"
          placeholder="Все компании"
          value={store.companies}
          options={companyOptions}
          onChange={(values) => store.updateFilter({ companies: values })}
        />
      </Field>

      <Field label="Инициаторы" htmlFor="filter-applicants">
        <MultiCombobox
          id="filter-applicants"
          placeholder="Все инициаторы"
          value={store.applicants}
          options={applicantOptions}
          onChange={(values) => store.updateFilter({ applicants: values })}
        />
      </Field>

      {canSeeResponsiblesFacet && (
        <Field label="Ответственные" htmlFor="filter-responsibles">
          <MultiCombobox
            id="filter-responsibles"
            placeholder="Все ответственные"
            value={store.responsibles}
            options={responsibleOptions}
            onChange={(values) => store.updateFilter({ responsibles: values })}
          />
        </Field>
      )}

      <Field label="Категории" htmlFor="filter-categories">
        <MultiCombobox
          id="filter-categories"
          placeholder="Все категории"
          value={store.categories}
          options={categoryOptions}
          onChange={(values) => store.updateFilter({ categories: values })}
        />
      </Field>

      <Field label="Состояние" htmlFor="filter-states">
        <MultiCombobox
          id="filter-states"
          placeholder="Любое состояние"
          value={store.states}
          options={STATE_OPTIONS}
          onChange={(values) => store.updateFilter({ states: values })}
        />
      </Field>
    </FilterContainer>
  );
};

export default TicketFilter;
