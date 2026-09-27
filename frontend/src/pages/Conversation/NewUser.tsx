import type { ComponentType } from "react";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import UserFormJs from "@/components/User/UserForm";
import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import type { ConversationCard } from "@/types/conversation";
import { splitPersonName } from "@/util/conversation-format";

import { linkIdentity } from "@/components/Conversation/conversation-actions";

// Граница типизации: форма на JS, пропсы с дефолтом TS выводит необязательными
// не всегда — описываем явно
const UserForm = UserFormJs as unknown as ComponentType<{
  onCreated?: (userId: string) => Promise<unknown> | void;
  successTo?: string;
}>;

type NewUserData = {
  companiesList: unknown[];
  categoriesList: unknown[];
  /** Заготовка формы: имя и телефон из мессенджера, компания диалога. */
  user: {
    firstName: string;
    lastName: string;
    phone: string;
    isEndUser: true;
    company: { _id: string } | null;
  };
  identityId: string;
  displayName: string;
};

/**
 * «Новый пользователь» из «Кто это?» (канва C2): та же форма пользователя,
 * что в справочнике, — шторкой поверх диалога и уже заполненная тем, что
 * известно о собеседнике. После сохранения собеседник связывается с новым
 * человеком, шторка возвращает в диалог.
 */
const ConversationNewUser = () => {
  const { identityId, displayName } = useLoaderData() as NewUserData;
  return (
    <UserForm
      successTo=".."
      onCreated={(userId) => linkIdentity(identityId, userId, displayName)}
    />
  );
};

export default ConversationNewUser;

export async function loader({ params }: LoaderFunctionArgs): Promise<NewUserData> {
  document.title = "Новый пользователь";
  const [card, companies, categories] = await Promise.all([
    api<ConversationCard>(`/api/conversations/${params.id}`),
    load<unknown[]>("/api/companies"),
    load<unknown[]>("/api/ticket-categories"),
  ]);
  const counterpart = card.counterpart;
  if (!counterpart) {
    throw new Response("Собеседник не найден", { status: 404 });
  }
  const { firstName, lastName } = splitPersonName(counterpart.name);
  return {
    companiesList: companies,
    categoriesList: categories,
    user: {
      firstName,
      lastName,
      phone: counterpart.phone,
      isEndUser: true,
      company: card.conversation.company ? { _id: card.conversation.company.id } : null,
    },
    identityId: counterpart.identityId,
    displayName: [lastName, firstName].filter(Boolean).join(" "),
  };
}
