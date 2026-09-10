import { useState } from "react";

import { RiMailLine, RiTelegramLine } from "react-icons/ri";

import { Checkbox } from "@/components/ui/checkbox";
import HealthRow from "@/components/app/HealthRow";
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

  // Каналы, выключенные глобально, перечисляем одной фразой: три отдельных
  // предупреждения подряд превращали шапку секции в стену.
  const telegramDisabled = !initialPrefs.telegramNotifications;
  const offChannels =
    emailDisabled && telegramDisabled
      ? "Почта и Telegram отключены администратором"
      : emailDisabled
        ? "Почта отключена администратором"
        : telegramDisabled
          ? "Telegram отключён администратором"
          : null;

  if (visibleCategories.length === 0) {
    return (
      <HealthRow
        state="warning"
        title="Уведомления отключены администратором"
        hint="Ни один канал не работает — настраивать нечего"
        className="border-t-0"
      />
    );
  }

  return (
    <>
      {/* Одно сообщение вместо стопки: выключенные каналы называются вместе,
          а «подключите бота» остаётся отдельной строкой — там есть что сделать */}
      {offChannels && (
        <HealthRow
          state="warning"
          title={offChannels}
          hint="Галочки ниже сохранятся, но сообщения приходить не будут"
          className="border-t-0"
        />
      )}
      {initialPrefs.telegramNotifications && !user.telegramBot?.isActive && (
        <HealthRow
          state="info"
          title="Бот Telegram не подключён"
          hint={
            <>
              Подключите его в разделе{" "}
              <a
                href="#integrations"
                className="font-medium text-accent-text underline"
              >
                Интеграции
              </a>
              , иначе Telegram-уведомления приходить не будут.
            </>
          }
          className="border-t-0"
        />
      )}

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
