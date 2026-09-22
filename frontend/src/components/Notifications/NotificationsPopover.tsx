import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useNotificationsStore from "@/store/notifications";
import { readAllLabel, unreadInFacet } from "@/util/notification-facets";

import FacetChips from "./FacetChips";
import NotificationsList from "./NotificationsList";

/**
 * Панель колокольчика на десктопе — поповер под кнопкой, как меню
 * пользователя рядом. Метка секции (eyebrow) со счётчиком и «Прочитать все»,
 * ряд чипов-фасетов, список со своим скроллом. Счётчик в заголовке — по всем
 * видам; «прочитать» при фильтре читает только показанный вид и так и
 * называется.
 */
type Props = { trigger: ReactNode };

const NotificationsPopover = ({ trigger }: Props) => {
  const open = useNotificationsStore((state) => state.open);
  const setOpen = useNotificationsStore((state) => state.setOpen);
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const unreadByCategory = useNotificationsStore(
    (state) => state.unreadByCategory,
  );
  const facet = useNotificationsStore((state) => state.facet);
  const markRead = useNotificationsStore((state) => state.markRead);
  const unreadHere = unreadInFacet(unreadByCategory, facet);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 text-xs font-bold tracking-wider text-faint uppercase">
          Уведомления
          {unreadCount > 0 && (
            <span className="font-semibold tracking-normal tabular-nums">
              · {unreadCount}
            </span>
          )}
          <span className="ms-auto flex items-center font-normal tracking-normal normal-case">
            {unreadHere > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void markRead({ all: true })}
              >
                {readAllLabel(facet)}
              </Button>
            )}
          </span>
        </div>
        <FacetChips className="px-4 pt-1 pb-2.5" />
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-2">
          <NotificationsList onNavigate={() => setOpen(false)} />
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationsPopover;
