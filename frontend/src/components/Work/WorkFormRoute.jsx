import { useContext } from "react";
import { useLoaderData, useParams } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";

import { AuthedUserContext } from "../../store/authed-user-context";
import useViewTicketStore from "../../store/view-ticket";
import { formatDate } from "../../util/format-date";

import WorkFormFields from "./WorkFormFields";
import { useWorkForm } from "./use-work-form";

/**
 * Форма работы как вложенный маршрут карточки заявки — одна на все режимы
 * («Новая работа», правка, планирование, подтверждение). Раньше это были три
 * почти дословно повторяющих друг друга файла, и они успели разойтись: блок
 * «вне графика» в двух из них не показывался вовсе (в компонент передавали
 * пропсы, которых он не принимает).
 *
 * Тело уходит JSON-ом: в нём массив заявок и булевы, а ручная сборка такого из
 * FormData — источник тихих потерь (см. ux-ui-guide, «Сложное вложенное тело»).
 */
const WorkFormRoute = ({ mode }) => {
  const { ticket, responsibles, otherCompanyTickets, works } =
    useViewTicketStore();
  const { limitWorksDateFrom } = useLoaderData() ?? {};
  const { workId } = useParams();
  const { isAdmin, _id: userId } = useContext(AuthedUserContext);

  const work = workId
    ? (works.find((item) => String(item._id) === workId) ?? null)
    : null;

  const form = useWorkForm({
    mode,
    work,
    ticketIds: [String(ticket._id)],
    currentUserId: userId,
  });

  return (
    <FormWrapper
      title={form.config.title}
      json={form.buildPayload}
      submitDisabled={!form.isValid}
    >
      {mode === "confirm" && work && (
        <div className="tw:mb-4 tw:flex tw:gap-2.5 tw:rounded-lg tw:border tw:border-border tw:bg-secondary tw:p-3">
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
            Запланировано на {formatDate(work.planningToStart)}
            {work.executor?.lastName
              ? ` · ${work.executor.lastName} ${work.executor.firstName?.[0] ?? ""}.`
              : ""}
            . <b className="tw:text-foreground">Поправьте время</b>, если
            работали иначе: доплата считается по фактическому.
          </p>
        </div>
      )}

      <WorkFormFields
        form={form}
        performers={responsibles}
        otherTickets={otherCompanyTickets}
        canPickPerformer={isAdmin}
        limitWorksDateFrom={limitWorksDateFrom}
      />
    </FormWrapper>
  );
};

export default WorkFormRoute;
