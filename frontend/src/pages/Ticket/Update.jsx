
import TicketFormRoute from "../../components/Ticket/TicketFormRoute";

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

    const headers = {};
    const api = import.meta.env.VITE_API_ADDRESS;

    const [formDataResponse, ticketResponse] = await Promise.all([
      fetch(`${api}/api/tickets/form-data`, { headers }),
      fetch(`${api}/api/tickets/${params.ticketNum}`, { headers }),
    ]);

    if (!formDataResponse.ok) throw formDataResponse;
    if (!ticketResponse.ok) throw ticketResponse;

    return {
      formData: await formDataResponse.json(),
      ticketData: await ticketResponse.json(),
    };
  };
}

export const loader = makeLoader("update");
