import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import {
  counterpartHandle,
  handleLabel,
  networkLabel,
} from "@/util/conversation-format";
import { formatPhone, toCanonicalPhone } from "@/util/phone";
import { monogramFor } from "@/components/app/monogram";

import ContactChannelRow, { CopyAction } from "./ContactChannelRow";

/**
 * Собеседник, связанный с пользователем HD (канва A1, B3): плитка с
 * инициалами, имя, «должность · компания» и каналы связи — этот диалог,
 * другие мессенджеры человека («Написать» открывает тот диалог), почта и
 * телефон с копированием. Телефон, уже показанный как номер мессенджера
 * (этот диалог или другой), второй строкой не повторяется.
 */
const ContactBlock = ({
  card,
  big = false,
}: {
  card: ConversationCard;
  big?: boolean;
}) => {
  const { contact, counterpart, conversation, otherChannels } = card;
  if (!contact) return null;
  // Телефон, уже показанный номером мессенджера (этот диалог или другой), второй
  // строкой не повторяется: сравниваем цифры, а не написание
  const shownPhones = new Set(
    [
      counterpart ? counterpartHandle(counterpart) : "",
      ...otherChannels.map((item) => item.handle),
    ]
      .map((handle) =>
        !handle || handle.startsWith("@") ? "" : toCanonicalPhone(handle),
      )
      .filter(Boolean),
  );

  return (
    <>
      {/* В шторке справа крестик — имя до него не доходит */}
      <div className={cn("flex items-center", big ? "gap-4 pr-9" : "gap-3")}>
        <span
          aria-hidden
          className={cn(
            "grid flex-none place-items-center rounded-[25%] bg-accent font-semibold text-muted-foreground inset-ring inset-ring-border",
            big ? "size-15 text-xl" : "size-11 text-base",
          )}
        >
          {monogramFor(contact.name)}
        </span>
        <div className="min-w-0">
          <div
            className={cn(
              "truncate leading-6 font-semibold",
              big ? "text-lg" : "text-base",
            )}
          >
            {contact.name}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {[contact.position, contact.company].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      <div className={cn("flex flex-col gap-2", big ? "mt-4.5" : "mt-3.5")}>
        {counterpart && (
          <ContactChannelRow
            channel={conversation.network}
            label={`${networkLabel(conversation.network)} · этот диалог`}
            value={counterpartHandle(counterpart) || counterpart.name}
            current
            big={big}
          />
        )}
        {otherChannels.map((item) => (
          <ContactChannelRow
            key={`${item.network}-${item.handle}`}
            channel={item.network}
            label={networkLabel(item.network)}
            value={handleLabel(item.handle) || "—"}
            big={big}
            action={
              item.conversationId ? (
                <Button asChild variant="ghost" size={big ? "sm" : "xs"}>
                  <Link to={`/conversations/${item.conversationId}`}>Написать</Link>
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
            action={<CopyAction value={contact.email} label="Адрес" what="почту" />}
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
              />
            }
          />
        )}
      </div>
    </>
  );
};

export default ContactBlock;
