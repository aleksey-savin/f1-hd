
import TicketFormRoute from "../../components/Ticket/TicketFormRoute";

const AddTicketPage = () => <TicketFormRoute mode="add" />;

export default AddTicketPage;

export async function loader({ request }) {
  document.title = "Новая заявка";

  const headers = {};
  const api = import.meta.env.VITE_API_ADDRESS;

  // Шаблоны тянет loader, а не эффект компонента: список нужен сразу, а его
  // отсутствие в первый кадр раньше прятало вход «Из шаблона»
  const [formDataResponse, templatesResponse] = await Promise.all([
    fetch(`${api}/api/tickets/form-data`, { headers }),
    fetch(`${api}/api/ticket-templates`, { headers }),
  ]);

  if (!formDataResponse.ok) throw formDataResponse;

  // Вход «Создать заявку» с карточки шаблона: заготовка приезжает целиком,
  // чтобы форма открылась уже заполненной
  const presetId = new URL(request.url).searchParams.get("template");
  let presetTemplate = null;
  if (presetId) {
    const presetResponse = await fetch(
      `${api}/api/ticket-templates/${presetId}`,
      { headers },
    );
    if (presetResponse.ok) presetTemplate = await presetResponse.json();
  }

  return {
    formData: await formDataResponse.json(),
    templates: templatesResponse.ok ? await templatesResponse.json() : [],
    presetTemplate,
  };
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
