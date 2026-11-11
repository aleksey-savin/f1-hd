import { ApiError, api } from "@/lib/api";
import useToastStore from "@/store/toast-store";

/**
 * Действия с диалогом (docs/messaging.md, «Staff API»). Каждое — запрос и
 * тост: при отказе человек видит причину сервера («Диалог уже привязан к
 * заявке 56790»), а не общую фразу. Возвращает true, если получилось.
 */

const toast = (variant: "success" | "danger", message: string) =>
  useToastStore.getState().showToast(variant, message);

export const failureText = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.status < 500 ? error.message : fallback;

const run = async (
  request: () => Promise<unknown>,
  { done, failed }: { done?: string; failed: string },
) => {
  try {
    await request();
    if (done) toast("success", done);
    return true;
  } catch (error) {
    toast("danger", failureText(error, failed));
    return false;
  }
};

const post = (path: string, body?: unknown) =>
  api(path, { method: "POST", body: body ?? {} });

export const markHandled = (id: string) =>
  run(() => post(`/api/conversations/${id}/handled`), {
    failed: "Не удалось отметить диалог",
  });

export const assignConversation = (id: string, userId: string | null) =>
  run(() => post(`/api/conversations/${id}/assign`, { userId }), {
    failed: "Не удалось назначить ответственного",
  });

export const bindConversation = (id: string, ticketNum: number) =>
  run(() => post(`/api/conversations/${id}/bind`, { ticketNum }), {
    done: `Диалог привязан к заявке ${ticketNum}`,
    failed: "Не удалось привязать диалог",
  });

export const unbindConversation = (id: string, ticketNum?: number) =>
  run(() => post(`/api/conversations/${id}/unbind`, { ticketNum }), {
    done: "Диалог отвязан от заявки",
    failed: "Не удалось отвязать диалог",
  });

export const chooseReplyContext = (id: string, ticketNum: number | null) =>
  post(`/api/conversations/${id}/context`, { ticketNum });

export const assignMessages = (
  id: string,
  messageIds: string[],
  ticketNum: number | null,
) =>
  run(
    () => post(`/api/conversations/${id}/attach`, { messageIds, ticketNum }),
    {
      done:
        ticketNum === null
          ? "Сообщения оставлены без заявки"
          : `Сообщения отнесены к заявке ${ticketNum}`,
      failed: "Не удалось изменить привязку сообщений",
    },
  );

export const answerNoTicket = (id: string) =>
  run(() => post(`/api/conversations/${id}/decision`, { action: "none" }), {
    failed: "Не удалось ответить на вопрос о заявке",
  });

export const setHidden = (id: string, hidden: boolean) =>
  run(() => post(`/api/conversations/${id}/hide`, { hidden }), {
    done: hidden
      ? "Диалог скрыт — он в фильтре «Скрытые»"
      : "Диалог снова в очередях",
    failed: hidden ? "Не удалось скрыть диалог" : "Не удалось вернуть диалог",
  });

export const linkIdentity = (
  identityId: string,
  userId: string,
  name: string,
) =>
  run(() => post(`/api/identities/${identityId}/link`, { userId }), {
    done: `Собеседник связан: ${name}`,
    failed: "Не удалось связать собеседника",
  });

export const unlinkIdentity = (identityId: string) =>
  run(() => post(`/api/identities/${identityId}/unlink`), {
    done: "Собеседник отвязан от пользователя",
    failed: "Не удалось отвязать собеседника",
  });
