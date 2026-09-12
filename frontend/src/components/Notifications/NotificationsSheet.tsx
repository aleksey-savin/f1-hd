import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import useNotificationsStore from "@/store/notifications";
import { plural } from "@/util/plural";

import NotificationsList from "./NotificationsList";

/**
 * Панель колокольчика на телефоне — нижняя шторка почти во весь экран, как
 * заметка базы знаний на карточке заявки. Заголовок шторки, под ним
 * «N непрочитанных» и «Прочитать все».
 */
type Props = { trigger: ReactNode };

const NotificationsSheet = ({ trigger }: Props) => {
  const open = useNotificationsStore((state) => state.open);
  const setOpen = useNotificationsStore((state) => state.setOpen);
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const markRead = useNotificationsStore((state) => state.markRead);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="h-[92dvh] gap-0">
        <div className="px-5 pt-4">
          <SheetTitle className="mt-1 mb-0 pe-8 text-lg leading-snug font-semibold tracking-tight">
            Уведомления
          </SheetTitle>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} ${plural(unreadCount, "непрочитанное", "непрочитанных", "непрочитанных")}`
              : "Всё прочитано"}
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="ms-auto"
                onClick={() => void markRead({ all: true })}
              >
                Прочитать все
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pt-1 pb-4">
          <NotificationsList onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default NotificationsSheet;
