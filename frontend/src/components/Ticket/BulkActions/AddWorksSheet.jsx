import { useContext, useMemo } from "react";

import FormSheet from "@/components/app/FormSheet";
import { Button } from "@/components/ui/button";

import { AuthedUserContext } from "../../../store/authed-user-context";
import WorkFormFields from "../../Work/WorkFormFields";
import { useWorkForm } from "../../Work/use-work-form";

/**
 * Массовое добавление работы к выбранным заявкам.
 *
 * Создаётся ОДНА запись работы, привязанная ко всем выбранным заявкам
 * (`Work.tickets[]`), а не по работе на заявку — прежняя подпись «Добавить
 * работы» это скрывала. Все заявки одной компании: гарантирует
 * `util/ticket-bulk-eligibility.addWorksReason`.
 *
 * Поля — те же `WorkFormFields`, что у формы на карточке заявки. Отличается
 * только отправка: список заявок живёт в состоянии страницы, маршрута у формы
 * нет, поэтому сабмит императивный (`onConfirm`), а футер свой.
 */
const AddWorksSheet = ({ show, onHide, selectedItems, onConfirm }) => (
  <FormSheet
    open={show}
    size="md"
    title="Новая работа"
    onOpenChange={(open) => !open && onHide()}
  >
    {/* Тело монтируется только на открытии: иначе поля прошлого вызова
        (и выбранные тогда заявки) достались бы следующему */}
    {show && (
      <AddWorksForm
        selectedItems={selectedItems}
        onHide={onHide}
        onConfirm={onConfirm}
      />
    )}
  </FormSheet>
);

const AddWorksForm = ({ selectedItems, onHide, onConfirm }) => {
  const { isAdmin, _id: userId } = useContext(AuthedUserContext);

  const ticketIds = useMemo(
    () => selectedItems.map((ticket) => String(ticket._id)),
    [selectedItems],
  );

  // Кандидаты в исполнители — объединение ответственных выбранных заявок
  const performers = useMemo(() => {
    const byId = new Map();
    for (const ticket of selectedItems) {
      for (const person of ticket.responsibles || []) {
        byId.set(String(person._id), person);
      }
    }
    return [...byId.values()];
  }, [selectedItems]);

  const form = useWorkForm({
    mode: "bulk",
    ticketIds,
    currentUserId: userId,
  });

  return (
    <>
      <h1 className="tw:my-0 tw:pr-10 tw:text-2xl tw:font-semibold tw:tracking-tight">
        Новая работа
      </h1>
      <p className="tw:mt-1 tw:mb-5 tw:text-sm tw:text-muted-foreground">
        Одна работа будет привязана к {selectedItems.length}{" "}
        {selectedItems.length === 1 ? "заявке" : "заявкам"}
        {selectedItems[0]?.company?.alias
          ? ` компании «${selectedItems[0].company.alias}»`
          : ""}
      </p>

      <WorkFormFields form={form} performers={performers} canPickPerformer={isAdmin} />

      <div className="tw:sticky tw:bottom-0 tw:-mx-6 tw:mt-6 tw:flex tw:items-center tw:justify-end tw:gap-2.5 tw:bg-background tw:px-6 tw:py-3">
        <Button type="button" variant="ghost" onClick={onHide}>
          Отмена
        </Button>
        <Button
          type="button"
          disabled={!form.isValid}
          onClick={() => {
            onConfirm(form.buildPayload());
            onHide();
          }}
        >
          Сохранить
        </Button>
      </div>
    </>
  );
};

export default AddWorksSheet;
