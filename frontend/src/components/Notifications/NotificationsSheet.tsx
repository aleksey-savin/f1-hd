import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import useNotificationsStore from "@/store/notifications";
import { readAllLabel, unreadInFacet } from "@/util/notification-facets";
import { plural } from "@/util/plural";

import FacetChips from "./FacetChips";
import NotificationsList from "./NotificationsList";

/**
 * Панель колокольчика на телефоне — нижняя шторка почти во весь экран, как
 * заметка базы знаний на карточке заявки. Заголовок шторки, под ним
 * «N непрочитанных» и «Прочитать все», ниже — ряд чипов-фасетов одной
 * строкой с прокруткой (ширины телефона на семь чипов не хватает).
 */
type Props = { trigger: ReactNode };

const NotificationsSheet = ({ trigger }: Props) => {
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
            {unreadHere > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="ms-auto"
                onClick={() => void markRead({ all: true })}
              >
                {readAllLabel(facet)}
              </Button>
            )}
          </div>
          {/* Отрицательные поля — чтобы прокрутка чипов доходила до края
              шторки, а не обрывалась на её отступе */}
          <FacetChips scroll className="-mx-5 mt-2.5 px-5 pb-1" />
        </div>
        <div className="flex-1 overflow-y-auto px-5 pt-1 pb-4">
          <NotificationsList onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default NotificationsSheet;
