import { useState } from "react";

import { isMobile } from "react-device-detect";
import { RiCloseLine } from "react-icons/ri";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCrumbFrom } from "@/components/app/Crumbs";
import { cn } from "@/lib/utils";

import useMinuteTick from "../../../hooks/use-minute-tick";
import { relativeDay } from "../../../util/relative-time";
import { describeClientTimezone } from "../../../util/timezone-display";
import ContactCard from "../../User/ContactCard";

/**
 * Инициатор в карточке заявки: клик по имени открывает попап с контактами, а не
 * уводит на страницу человека (макет «Инициатор в заявке», вариант A).
 *
 * Так было до редизайна карточки (прежний `ApplicantModal`), и так и нужно: на
 * инициатора смотрят, чтобы позвонить или написать, не теряя заявку из виду.
 * Страница человека остаётся вторым шагом — кнопкой «Открыть профиль».
 *
 * Оболочек две, содержимое одно (`User/ContactCard`): на десктопе — поповер у
 * имени, на телефоне — нижняя шторка, тем же языком, что контакт в адресной
 * книге. Строка состояния здесь — местное время абонента: отсюда идут звонить.
 */
const ApplicantPopup = ({ ticket, applicant, from }) => {
  const [open, setOpen] = useState(false);
  const profileState = useCrumbFrom(from);
  // Часы идут, только пока попап открыт. Тик нужен ради перерисовки, а время
  // берём заново: состояние хука помнит момент МОНТИРОВАНИЯ карточки, и попап,
  // открытый через полчаса, показал бы время получасовой давности
  useMinuteTick(open);
  const now = new Date();

  const name =
    `${applicant.lastName ?? ""} ${applicant.firstName ?? ""}`.trim();
  const clientTime = describeClientTimezone(ticket.clientTimezone, now);
  const computer = applicant.computer;
  const lastSeen = relativeDay(computer?.lastSeenAt);

  const card = (
    <ContactCard
      item={applicant}
      compact={!isMobile}
      meta={[applicant.position, ticket.company?.alias]
        .filter(Boolean)
        .join(" · ")}
      status={
        clientTime?.differs ? (
          <div
            title={clientTime.title}
            className={cn(
              "mt-0.5 text-sm tabular-nums",
              // Ночь у абонента — единственное состояние, где нужен сигнал
              clientTime.isNight ? "text-warning" : "text-muted-foreground",
            )}
          >
            сейчас у абонента {clientTime.localTime} ({clientTime.offsetLabel})
          </div>
        ) : null
      }
      computer={
        computer?.name
          ? {
              name: computer.name,
              label: lastSeen ? `Компьютер · вход ${lastSeen}` : "Компьютер",
            }
          : null
      }
      profileState={profileState}
      onNavigate={() => setOpen(false)}
    />
  );

  // Кнопка, а не ссылка: она ничего не открывает по адресу. Вид — как у ссылок
  // на сущности в карточке (app/EntityLink); открыта — держит акцент
  const trigger = (
    <button
      type="button"
      onClick={isMobile ? () => setOpen(true) : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn(
        "cursor-pointer appearance-none border-0 bg-transparent p-0 font-medium underline-offset-3 hover:text-accent-text hover:underline",
        open ? "text-accent-text underline" : "text-foreground",
      )}
    >
      {name}
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-5 pb-7"
          >
            <SheetTitle className="sr-only">{name || "Инициатор"}</SheetTitle>
            <SheetDescription className="sr-only">
              Контакты инициатора заявки
            </SheetDescription>
            {card}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        aria-label="Инициатор заявки"
        className="relative w-85 rounded-xl p-4"
      >
        {/* У шторки крестик свой (ui/sheet), поповеру его даём сами — место
            под него оставляет шапка карточки (pr-8) */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Закрыть"
          className="absolute top-2.5 right-2.5 grid size-7 cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <RiCloseLine size={16} />
        </button>
        {card}
      </PopoverContent>
    </Popover>
  );
};

export default ApplicantPopup;
