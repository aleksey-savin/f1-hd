import { isMobile } from "react-device-detect";
import { RiNotification3Fill, RiNotification3Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import useNotificationsStore from "@/store/notifications";

import NotificationsPopover from "./NotificationsPopover";
import NotificationsSheet from "./NotificationsSheet";

/**
 * Колокольчик рядом со статусом: та же высота 32px (44px на телефоне) и
 * иконка 16px. Счётчик справа от иконки, на одной вертикальной середине.
 * Панель — поповер на десктопе, шторка снизу на
 * телефоне.
 *
 * Сводку приносит пульс оболочки (components/app/PulseLoop) — первый же ответ
 * и потом при каждом изменении входящих. Подписки узкие — новая сводка
 * перерисовывает колокольчик, а не оболочку.
 */
const Bell = () => {
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const open = useNotificationsStore((state) => state.open);

  const trigger = (
    <Button
      variant="ghost"
      size={isMobile ? "icon-lg" : "icon-xs"}
      aria-label={
        unreadCount > 0
          ? `Уведомления, непрочитанных: ${unreadCount}`
          : "Уведомления"
      }
      title="Уведомления"
      className={`${isMobile ? "min-w-11" : "min-w-8"} w-auto gap-1.5 px-2 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground`}
    >
      {open ? (
        <RiNotification3Fill size={16} aria-hidden className="size-4" />
      ) : (
        <RiNotification3Line size={16} aria-hidden className="size-4" />
      )}
      {unreadCount > 0 && (
        <span className="inline-grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground tabular-nums">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Button>
  );

  return isMobile ? (
    <NotificationsSheet trigger={trigger} />
  ) : (
    <NotificationsPopover trigger={trigger} />
  );
};

export default Bell;
