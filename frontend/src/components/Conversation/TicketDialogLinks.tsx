import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ConversationTicket } from "@/types/conversation";
import { networkLabel } from "@/util/conversation-format";

import { ChannelIcon } from "./ChannelGlyph";

type Dialog = NonNullable<ConversationTicket["otherDialogs"]>[number];
const DialogLink = ({ dialog, expanded = false, onNavigate }: { dialog: Dialog; expanded?: boolean; onNavigate?: () => void }) => {
  const label = `${networkLabel(dialog.network)} · ${dialog.title || "Диалог"}`;
  return (
    <Button asChild variant="ghost" size="sm" className={`h-8 min-w-0 justify-start gap-1.5 px-2 text-xs pointer-coarse:min-h-11 ${expanded ? "w-full" : "flex-1"}`}>
      <Link onClick={onNavigate} to={`/conversations/${dialog.id}`} title={label} aria-label={`Открыть диалог: ${label}`}>
        <ChannelIcon network={dialog.network} className="shrink-0" />
        <span className="truncate">{dialog.title || networkLabel(dialog.network)}</span>
      </Link>
    </Button>
  );
};

/** Two direct links keep the ticket compact; the rest remain one click away. */
const TicketDialogLinks = ({ ticket }: { ticket: ConversationTicket }) => {
  const [open, setOpen] = useState(false);
  const dialogs = ticket.otherDialogs || [];
  if (!dialogs.length) return null;
  return (
    <nav aria-label={`Другие диалоги заявки ${ticket.num}`} className="mx-4 flex min-w-0 items-center gap-1 border-t border-border-soft py-1.5">
      {dialogs.slice(0, 2).map(dialog => <DialogLink key={dialog.id} dialog={dialog} />)}
      {dialogs.length > 2 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs pointer-coarse:min-h-11" aria-label={`Ещё диалоги: ${dialogs.length - 2}`}>
              +{dialogs.length - 2}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-72 max-w-[calc(100vw-2rem)] overflow-y-auto p-1">
            {dialogs.slice(2).map(dialog => <DialogLink key={dialog.id} dialog={dialog} expanded onNavigate={() => setOpen(false)} />)}
          </PopoverContent>
        </Popover>
      )}
    </nav>
  );
};
export default TicketDialogLinks;
