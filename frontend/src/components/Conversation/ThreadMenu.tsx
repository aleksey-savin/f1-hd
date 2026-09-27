import { Link, useNavigate } from "react-router";
import { RiMoreLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCan } from "@/store/authed-user";
import type { ConversationCard } from "@/types/conversation";

import { setHidden, unlinkIdentity } from "./conversation-actions";

/** Пункты «Действий с диалогом» — одни и те же в меню «⋯» и в шторке телефона. */
export const useThreadActions = (
  card: ConversationCard,
  { canManage, onChanged }: { canManage: boolean; onChanged: () => void },
) => {
  const navigate = useNavigate();
  const canReadUsers = useCan()({ user: ["read"] });
  const { conversation, counterpart, contact } = card;
  const items: { key: string; label: string; to?: string; run?: () => void }[] = [];

  if (contact && canReadUsers) {
    items.push({ key: "profile", label: "Открыть профиль", to: `/users/${contact.id}` });
  }
  if (canManage && counterpart?.userId) {
    items.push({
      key: "unlink",
      label: "Отвязать собеседника",
      run: () =>
        void unlinkIdentity(counterpart.identityId).then((ok) => ok && onChanged()),
    });
  }
  if (canManage) {
    items.push({
      key: "hide",
      label: conversation.hidden ? "Вернуть в очереди" : "Скрыть диалог",
      run: () =>
        void setHidden(conversation.id, !conversation.hidden).then((ok) => {
          if (!ok) return;
          if (conversation.hidden) onChanged();
          else navigate("/conversations");
        }),
    });
  }
  return items;
};

/** «⋯» в шапке переписки на десктопе (канва A1). Нечего предложить — кнопки нет. */
const ThreadMenu = ({
  card,
  canManage,
  onChanged,
}: {
  card: ConversationCard;
  canManage: boolean;
  onChanged: () => void;
}) => {
  const items = useThreadActions(card, { canManage, onChanged });
  if (!items.length) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Действия с диалогом"
          title="Действия с диалогом"
        >
          <RiMoreLine />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {items.map((item) =>
          item.to ? (
            <DropdownMenuItem key={item.key} asChild>
              <Link to={item.to}>{item.label}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.key} onSelect={item.run}>
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ThreadMenu;
