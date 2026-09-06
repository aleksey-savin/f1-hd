import TicketFormRoute from "../../components/Ticket/TicketFormRoute";
import { load } from "@/store/form-data";

const AddTicketPage = () => <TicketFormRoute mode="add" />;

export default AddTicketPage;

export async function loader({ request }) {
  document.title = "Новая заявка";

  // Шторка открывается по готовности данных, поэтому справочники — из кэша
  // (store/form-data): без него каждое открытие ждало бы form-data и список
  // шаблонов. Шаблоны тянет loader, а не эффект компонента: список нужен
  // сразу, а его отсутствие в первый кадр раньше прятало вход «Из шаблона».
  // Вход «Создать заявку» с карточки шаблона (?template=<id>): заготовка
  // приезжает целиком, чтобы форма открылась уже заполненной.
  const presetId = new URL(request.url).searchParams.get("template");
  const [formData, templates, presetTemplate] = await Promise.all([
    load("/api/tickets/form-data"),
    load("/api/ticket-templates").catch(() => []),
    presetId
      ? load(`/api/ticket-templates/${presetId}`).catch(() => null)
      : null,
  ]);

  return { formData, templates, presetTemplate };
}

export async function action({ request }) {
  // Тело пересылаем как есть: в нём файлы вложений, а multipart собирается
  // браузером вместе с boundary — Content-Type руками не ставим
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/add`,
    {
      method: "POST",
      body: await request.formData(),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: true,
      message: data.message || "Не удалось создать заявку",
    };
  }

  // Ответ с созданной заявкой нужен FormWrapper: по нему строится адрес её
  // карточки (см. «Навигация после сабмита» в ux-ui-guide)
  return data;
}
