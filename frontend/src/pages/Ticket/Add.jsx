import TicketFormRoute from "../../components/Ticket/TicketFormRoute";
import { api } from "@/lib/api";
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
  // приезжает целиком, чтобы форма открылась уже заполненной. Шаблон —
  // сущность, а не справочник: всегда свежий, иначе устаревший состав
  // вопросов упёрся бы в проверку обязательных ответов на сервере
  const url = new URL(request.url);
  const presetId = url.searchParams.get("template");
  const [formData, templates, presetTemplate, origin] = await Promise.all([
    load("/api/tickets/form-data"),
    load("/api/ticket-templates").catch(() => []),
    presetId
      ? load(`/api/ticket-templates/${presetId}`, {
          maxAge: 0,
          staleMax: 0,
        }).catch(() => null)
      : null,
    loadOrigin(url.searchParams),
  ]);

  return { formData, templates, presetTemplate, ...origin };
}

/**
 * «Создать заявку» из диалога (`?conversation=<id>&messages=<id,id>`):
 * черновик собирает сервер — описание из сообщений, заявитель и компания
 * собеседника (`GET /api/conversations/:id/ticket-draft`). Отказ (диалог
 * привязан к другой открытой заявке, модуль выключен) форма показывает
 * вместо полей.
 */
async function loadOrigin(searchParams) {
  const conversationId = searchParams.get("conversation");
  if (!conversationId) return { presetOrigin: null, originError: null };
  const messageIds = (searchParams.get("messages") || "")
    .split(",")
    .filter(Boolean);
  try {
    const draft = await api(
      `/api/conversations/${conversationId}/ticket-draft?${new URLSearchParams({ messages: messageIds.join(",") })}`,
    );
    return {
      presetOrigin: { conversationId, messageIds, draft },
      originError: null,
    };
  } catch (error) {
    return {
      presetOrigin: null,
      originError: error?.message || "Не удалось собрать заявку из диалога",
    };
  }
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
