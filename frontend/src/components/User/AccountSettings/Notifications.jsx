import { Fragment, useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { RiMailLine, RiTelegramLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import AlertMessage from "@/components/app/AlertMessage";
import { cn } from "@/lib/utils";
import useToastStore from "../../../store/toast-store";

// Категории личных уведомлений. Матрица «событие × канал» — вместо двух
// легаси-списков свитчей. Имена полей формы (tg*/email*) — контракт
// router-экшена my-account (см. pages/User/MyAccount.jsx).
//
// Скрытые глобальными настройками категории всё равно уходят в FormData
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
    label: "Изменение срока заявки",
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
  <span className="tw:flex tw:w-20 tw:flex-none tw:items-center tw:justify-center tw:gap-1.5 tw:text-xs tw:font-semibold tw:tracking-wider tw:text-muted-foreground tw:uppercase tw:max-md:w-14">
    <Icon size={14} aria-hidden />
    <span className="tw:max-md:hidden">{full}</span>
    <span className="tw:md:hidden">{short}</span>
  </span>
);

const Notifications = ({ user, initialPrefs }) => {
  const fetcher = useFetcher();
  const { showToast } = useToastStore();

  const [values, setValues] = useState(() => {
    const notify = user.notify ?? {};
    const initial = {};
    for (const category of CATEGORIES) {
      initial[`tg${category.name}`] = !!category.getTg(notify);
      initial[`email${category.name}`] = !!category.getEmail(notify);
    }
    return initial;
  });

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      showToast(
        fetcher.data.error ? "danger" : "success",
        fetcher.data.message,
      );
    }
  }, [fetcher.state, fetcher.data]);

  const visibleCategories = CATEGORIES.filter(
    (category) => initialPrefs.personalNotifications?.[category.visibilityKey],
  );

  const tgDisabled =
    !user.telegramBot?.isActive || !initialPrefs.telegramNotifications;
  const emailDisabled = !initialPrefs.emailNotifications;

  const toggle = (key) =>
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));

  if (visibleCategories.length === 0) {
    return (
      <AlertMessage
        variant="warning"
        message="Уведомления отключены в глобальных настройках приложения. Для их активации обратитесь к администратору."
        className="tw:m-5"
      />
    );
  }

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="id" value={user._id} />
      {/* Скрытые поля — все категории, включая невидимые: контракт экшена */}
      {CATEGORIES.map((category) => (
        <Fragment key={category.name}>
          <input
            type="hidden"
            name={`tg${category.name}`}
            value={values[`tg${category.name}`] ? "true" : "false"}
          />
          <input
            type="hidden"
            name={`email${category.name}`}
            value={values[`email${category.name}`] ? "true" : "false"}
          />
        </Fragment>
      ))}

      <div className="tw:px-5 tw:pt-4">
        {!initialPrefs.telegramNotifications && (
          <AlertMessage
            variant="warning"
            message="Telegram-уведомления отключены в глобальных настройках приложения. Для их активации обратитесь к администратору."
            className="tw:my-0 tw:mb-3"
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
                  className="tw:font-medium tw:text-accent-text tw:underline"
                >
                  Интеграции
                </a>
                .
              </>
            }
            className="tw:my-0 tw:mb-3"
          />
        )}
        {!initialPrefs.emailNotifications && (
          <AlertMessage
            variant="warning"
            message="Email-уведомления отключены в глобальных настройках приложения. Для их активации обратитесь к администратору."
            className="tw:my-0 tw:mb-3"
          />
        )}
      </div>

      <div className="tw:flex tw:items-center tw:px-5 tw:pt-1 tw:pb-2.5">
        <span className="tw:flex-1" />
        {channelHeader(RiTelegramLine, "Telegram", "TG")}
        {channelHeader(RiMailLine, "E-mail", "Mail")}
      </div>
      {visibleCategories.map((category) => (
        <div
          key={category.name}
          className="tw:flex tw:items-center tw:border-t tw:border-border-soft tw:px-5 tw:py-3.5"
        >
          <span className="tw:min-w-0 tw:flex-1 tw:pe-2 tw:text-base">
            {category.label}
          </span>
          {["tg", "email"].map((channel) => {
            const key = `${channel}${category.name}`;
            const disabled = channel === "tg" ? tgDisabled : emailDisabled;
            return (
              <span
                key={channel}
                className="tw:grid tw:w-20 tw:flex-none tw:place-items-center tw:max-md:w-14"
              >
                <Checkbox
                  className={cn("tw:size-5", disabled && "tw:opacity-40")}
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

      <div className="tw:flex tw:justify-end tw:border-t tw:border-border-soft tw:px-5 tw:py-3">
        <Button
          type="submit"
          name="intent"
          value="notifications-update"
          disabled={fetcher.state !== "idle"}
        >
          Сохранить
        </Button>
      </div>
    </fetcher.Form>
  );
};

export default Notifications;
