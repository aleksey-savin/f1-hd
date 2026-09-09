import { useContext, useMemo } from "react";

import FormSheet from "@/components/app/FormSheet";
import { FormActions } from "@/components/app/FormLayout";
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
 * Поля — те же `WorkFormFields`, что у формы на карточке заявки, поэтому и
 * ширина шторки та же (`lg`): одна форма — одной ширины, откуда её ни открыли.
 * Отличается только отправка: список заявок живёт в состоянии страницы,
 * маршрута у формы нет, поэтому сабмит императивный (`onConfirm`), а футер свой.
 */
const AddWorksSheet = ({ show, onHide, selectedItems, onConfirm }) => (
  <FormSheet
    open={show}
    size="lg"
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
      <h1 className="my-0 pr-10 text-2xl font-semibold tracking-tight">
        Новая работа
      </h1>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        Одна работа будет привязана к {selectedItems.length}{" "}
        {selectedItems.length === 1 ? "заявке" : "заявкам"}
        {selectedItems[0]?.company?.alias
          ? ` компании «${selectedItems[0].company.alias}»`
          : ""}
      </p>

      <WorkFormFields
        form={form}
        performers={performers}
        canPickPerformer={isAdmin}
      />

      <FormActions className="justify-end">
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
      </FormActions>
    </>
  );
};

export default AddWorksSheet;
