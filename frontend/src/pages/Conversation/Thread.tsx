import {
  useParams,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import ConversationThread, {
  type ThreadData,
} from "@/components/Conversation/ConversationThread";
import { api } from "@/lib/api";
import type { ConversationCard, MessagesPage } from "@/types/conversation";
import { PAGE_SIZE } from "@/util/conversation-thread";

/**
 * Маршрут одного диалога (`/conversations/:id`): карточка и первая страница
 * ленты — одним загрузчиком, чтобы переписка открывалась готовой. Чужой или
 * исчезнувший диалог — 404 сервера, его рисует страница ошибок с контекстом
 * раздела «Диалоги» (util/sections).
 *
 * `key={id}`: роутер держит один и тот же `ConversationThread` для любого
 * `/conversations/:id`, и без ключа переход между диалогами не размонтирует
 * его — черновик ответа (`Composer`) и поиск собеседника (`WhoIsThis`)
 * пережили бы смену диалога. Ключ по id заставляет React пересобрать
 * поддерево, и всё локальное состояние сбрасывается.
 */
const ConversationThreadRoute = () => {
  const { id } = useParams();
  return <ConversationThread key={id} />;
};

export default ConversationThreadRoute;

export async function loader({ params }: LoaderFunctionArgs): Promise<ThreadData> {
  const [card, page] = await Promise.all([
    api<ConversationCard>(`/api/conversations/${params.id}`),
    api<MessagesPage>(`/api/conversations/${params.id}/messages?limit=${PAGE_SIZE}`),
  ]);
  document.title = card.conversation.title
    ? `Диалог · ${card.conversation.title}`
    : "Диалог";
  return { card, page };
}

/**
 * Закрылась шторка формы поверх диалога («Создать заявку», «Новый
 * пользователь») — диалог перечитываем: привязка и собеседник могли
 * измениться, а роутер сам загрузчик оставшегося маршрута не повторяет.
 */
export const shouldRevalidate = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) =>
  defaultShouldRevalidate ||
  (currentUrl.pathname !== nextUrl.pathname &&
    currentUrl.pathname.startsWith(`${nextUrl.pathname}/`));
