import { Link } from "@/components/app/navigation";
import type { ReactNode } from "react";


import { Button } from "@/components/ui/button";
import type { ConversationCard } from "@/types/conversation";
import {
  counterpartHandle,
  handleLabel,
  networkLabel,
} from "@/util/conversation-format";
import { uniqueOtherChannels } from "@/util/conversation-contact";
import { formatPhone, toCanonicalPhone } from "@/util/phone";

import ContactChannelRow, { CopyAction } from "./ContactChannelRow";

/** Каналы связанного пользователя; имя и компания остаются в списке диалогов. */
const ContactBlock = ({
  card,
  big = false,
  actions,
}: {
  card: ConversationCard;
  big?: boolean;
  /** Меню действий в конце строки текущего диалога. */
  actions?: ReactNode;
}) => {
  const { contact, counterpart, conversation } = card;
  if (!contact) return null;
  const currentHandle = counterpartHandle(counterpart);
  const otherChannels = uniqueOtherChannels({
    network: conversation.network,
    currentHandle,
    otherChannels: card.otherChannels,
  });
  // Телефон, уже показанный номером мессенджера, второй строкой не повторяется.
  const shownPhones = new Set(
    [currentHandle, ...otherChannels.map((item) => item.handle)]
      .map((handle) =>
        /^[+\d\s().-]+$/.test(handle) ? toCanonicalPhone(handle) : "",
      )
      .filter(Boolean),
  );

  return (
    <div className="flex flex-col" aria-label="Контакты собеседника">
      {counterpart ? (
        <ContactChannelRow
          channel={conversation.network}
          label={networkLabel(conversation.network)}
          value={currentHandle || counterpart.name}
          current
          big={big}
          actions={actions}
        />
      ) : (
        <div className="flex min-h-9 items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{networkLabel(conversation.network)}</span>
          {actions}
        </div>
      )}
      {otherChannels.map((item) => (
        <ContactChannelRow
          key={`${item.network}-${item.handle}`}
          channel={item.network}
          label={networkLabel(item.network)}
          value={
            (/^[+\d\s().-]+$/.test(item.handle)
              ? handleLabel(item.handle)
              : item.handle) || "—"
          }
          big={big}
          action={
            item.conversationId ? (
              <Button
                asChild
                variant="link"
                size={big ? "lg" : "xs"}
                className="px-1"
              >
                <Link to={`/conversations/${item.conversationId}`}>
                  Написать
                </Link>
              </Button>
            ) : undefined
          }
        />
      ))}
      {contact.email && (
        <ContactChannelRow
          channel="mail"
          label="Почта"
          value={contact.email}
          big={big}
          action={
            <CopyAction
              value={contact.email}
              label="Адрес"
              what="почту"
              big={big}
            />
          }
        />
      )}
      {contact.phone && !shownPhones.has(toCanonicalPhone(contact.phone)) && (
        <ContactChannelRow
          channel="phone"
          label="Телефон"
          value={formatPhone(contact.phone)}
          big={big}
          action={
            <CopyAction
              value={formatPhone(contact.phone)}
              label="Телефон"
              what="телефон"
              big={big}
            />
          }
        />
      )}
    </div>
  );
};

export default ContactBlock;
