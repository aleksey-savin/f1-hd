import { useState } from "react";

import { RiMailLine, RiTelegramLine } from "react-icons/ri";

import { Checkbox } from "@/components/ui/checkbox";
import AlertMessage from "@/components/app/AlertMessage";
import { useDraftSection } from "@/components/app/draft-context";
import { cn } from "@/lib/utils";

// Категории личных уведомлений. Матрица «событие × канал» — вместо двух
// легаси-списков свитчей. visibilityKey — он же ключ поля в user.notify.
//
// Скрытые глобальными настройками категории всё равно уходят в теле запроса
// текущими значениями, иначе каждое сохранение молча сбрасывало бы их в
// false (баг легаси).
const CATEGORIES = [
  {
    name: "NewTicket",
    label: "Новая заявка",
    visibilityKey: "newTicket",
    getTg: (notify) => notify.byTelegram?.newTicket,
    getEmail: (notify) => notify.byEmail?.newTicket,
  },
  {
    name: "RespStateUpdate",
    label: "Изменение статуса ответственного за заявку",
    visibilityKey: "respStateUpdate",
    // Ответственным по заявке бывает только сотрудник — клиенту строка ни о чём
    staffOnly: true,
    getTg: (notify) => notify.byTelegram?.respStateUpdate,
    getEmail: (notify) => notify.byEmail?.respStateUpdate,
  },
  {
    name: "TicketStateUpdate",
    label: "Изменение статуса заявки",
    visibilityKey: "ticketStateUpdate",
    getTg: (notify) => notify.byTelegram?.ticketStateUpdate,
    getEmail: (notify) => notify.byEmail?.ticketStateUpdate,
  },
  {
    name: "TicketDeadlineUpdate",
    label: "Изменения срока выполнения",
    visibilityKey: "ticketDeadlineUpdate",
    getTg: (notify) => notify.byTelegram?.ticketDeadlineUpdate,
    getEmail: (notify) => notify.byEmail?.ticketDeadlineUpdate,
  },
  {
    name: "TicketNewComment",
    label: "Новые комментарии",
    visibilityKey: "ticketNewComment",
    getTg: (notify) => notify.byTelegram?.ticketNewComment,
    getEmail: (notify) => notify.byEmail?.ticketNewComment,
  },
  {
    name: "ScheduledWorks",
    label: "Запланированные работы",
    visibilityKey: "scheduledWorks",
    getTg: (notify) => notify.byTelegram?.scheduledWorks,
    getEmail: (notify) => notify.byEmail?.scheduledWorks,
  },
];

const channelHeader = (Icon, full, short) => (
  <span className="flex w-20 flex-none items-center justify-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase max-md:w-14">
    <Icon size={14} aria-hidden />
    <span className="max-md:hidden">{full}</span>
    <span className="md:hidden">{short}</span>
  </span>
);

const Notifications = ({ user, initialPrefs }) => {
  const [values, setValues] = useState(() => {
    const notify = user.notify ?? {};
    const initial = {};
    for (const category of CATEGORIES) {
      initial[`tg${category.name}`] = !!category.getTg(notify);
      initial[`email${category.name}`] = !!category.getEmail(notify);
    }
    return initial;
  });

  useDraftSection(() => {
    const byTelegram = {};
    const byEmail = {};
    for (const category of CATEGORIES) {
      byTelegram[category.visibilityKey] = !!values[`tg${category.name}`];
      byEmail[category.visibilityKey] = !!values[`email${category.name}`];
    }
    return { notify: { byTelegram, byEmail } };
  });

  const visibleCategories = CATEGORIES.filter(
    (category) =>
      initialPrefs.personalNotifications?.[category.visibilityKey] &&
      (!category.staffOnly || !user.isEndUser),
  );

  const tgDisabled =
    !user.telegramBot?.isActive || !initialPrefs.telegramNotifications;
  const emailDisabled = !initialPrefs.emailNotifications;

  const toggle = (key) => setValues((prev) => ({ ...prev, [key]: !prev[key] }));

  if (visibleCategories.length === 0) {
    return (
      <AlertMessage
        variant="warning"
        message="Уведомления отключены в глобальных настройках приложения. Для их активации обратитесь к администратору."
        className="m-5"
      />
    );
  }

  return (
    <>
      <div className="px-5 pt-4">
        {!initialPrefs.telegramNotifications && (
          <AlertMessage
            variant="warning"
            message="Telegram-уведомления отключены в глобальных настройках приложения. Для их активации обратитесь к администратору."
            className="my-0 mb-3"
          />
        )}
        {initialPrefs.telegramNotifications && !user.telegramBot?.isActive && (
          <AlertMessage
            variant="warning"
            message={
              <>
                Для отправки Telegram-уведомлений подключите бота в разделе{" "}
                <a
                  href="#integrations"
                  className="font-medium text-accent-text underline"
                >
                  Интеграции
                </a>
                .
              </>
            }
            className="my-0 mb-3"
          />
        )}
        {!initialPrefs.emailNotifications && (
          <AlertMessage
            variant="warning"
            message="Email-уведомления отключены в глобальных настройках приложения. Для их активации обратитесь к администратору."
            className="my-0 mb-3"
          />
        )}
      </div>

      <div className="flex items-center px-5 pt-1 pb-2.5">
        <span className="flex-1" />
        {channelHeader(RiTelegramLine, "Telegram", "TG")}
        {channelHeader(RiMailLine, "E-mail", "Mail")}
      </div>
      {visibleCategories.map((category) => (
        <div
          key={category.name}
          className="flex items-center border-t border-border-soft px-5 py-3.5"
        >
          <span className="min-w-0 flex-1 pe-2 text-base">
            {category.label}
          </span>
          {["tg", "email"].map((channel) => {
            const key = `${channel}${category.name}`;
            const disabled = channel === "tg" ? tgDisabled : emailDisabled;
            return (
              <span
                key={channel}
                className="grid w-20 flex-none place-items-center max-md:w-14"
              >
                <Checkbox
                  className={cn("size-5", disabled && "opacity-40")}
                  checked={values[key]}
                  disabled={disabled}
                  onCheckedChange={() => toggle(key)}
                  aria-label={`${category.label} — ${
                    channel === "tg" ? "Telegram" : "e-mail"
                  }`}
                />
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
};

export default Notifications;
