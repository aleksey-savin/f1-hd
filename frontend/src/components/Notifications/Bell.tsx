import { isMobile } from "react-device-detect";
import { RiNotification3Fill, RiNotification3Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import useNotificationsStore from "@/store/notifications";

import NotificationsPopover from "./NotificationsPopover";
import NotificationsSheet from "./NotificationsSheet";

/**
 * Колокольчик в баре оболочки: служебная кнопка рядом с темой (тот же ghost
 * icon-xs), значок-счётчик в углу — заливка primary с кольцом цвета панели,
 * чтобы отделиться от иконки. Панель — поповер на десктопе, шторка снизу на
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
      size="icon-xs"
      aria-label={
        unreadCount > 0
          ? `Уведомления, непрочитанных: ${unreadCount}`
          : "Уведомления"
      }
      title="Уведомления"
      className="relative text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
    >
      {open ? (
        <RiNotification3Fill size={16} aria-hidden />
      ) : (
        <RiNotification3Line size={16} aria-hidden />
      )}
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground tabular-nums ring-2 ring-card">
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
