import TicketFormRoute from "../../components/Ticket/TicketFormRoute";
import { api } from "@/lib/api";
import { load } from "@/store/form-data";

/**
 * Правка и обработка заявки — один и тот же набор полей, поэтому одна страница
 * с режимом. «Обработать» отличается подписью сабмита и тем, что ставит отметки
 * обработки на сервере.
 */
const UpdateTicketPage = ({ mode = "update" }) => (
  <TicketFormRoute mode={mode} />
);

export default UpdateTicketPage;

export function makeLoader(mode) {
  return async function loader({ params }) {
    document.title =
      mode === "process"
        ? `Обработать заявку ${params.ticketNum}`
        : `Изменить заявку ${params.ticketNum}`;

    // Справочники — из кэша (store/form-data); сама заявка — всегда свежая:
    // её правят многие и часто. `?view=form` отдаёт одну заявку без компании,
    // журналов и работ — карточных данных, которые форма не читает.
    const [formData, ticketData] = await Promise.all([
      load("/api/tickets/form-data"),
      api(`/api/tickets/${params.ticketNum}?view=form`),
    ]);

    return { formData, ticketData };
  };
}

export const loader = makeLoader("update");
