import { useState } from "react";

import {
  RiMailLine,
  RiNotification3Line,
  RiTelegramLine,
} from "react-icons/ri";

import { Checkbox } from "@/components/ui/checkbox";
import HealthRow from "@/components/app/HealthRow";
import { useDraftSection } from "@/components/app/draft-context";
import { cn } from "@/lib/utils";

import { NOTIFY_CHANNELS } from "../permissions-catalog";

// Категории личных уведомлений. Матрица «событие × канал» — вместо двух
// легаси-списков свитчей. visibilityKey — он же ключ поля в user.notify.
//
// Скрытые глобальными настройками категории всё равно уходят в теле запроса
// текущими значениями, иначе каждое сохранение молча сбрасывало бы их в
// false (баг легаси).
const CATEGORIES = [
  { name: "NewTicket", label: "Новая заявка", visibilityKey: "newTicket" },
  {
    name: "RespStateUpdate",
    label: "Изменение статуса ответственного за заявку",
    visibilityKey: "respStateUpdate",
    // Ответственным по заявке бывает только сотрудник — клиенту строка ни о чём
    staffOnly: true,
  },
  {
    name: "TicketStateUpdate",
    label: "Изменение статуса заявки",
    visibilityKey: "ticketStateUpdate",
  },
  {
    name: "TicketDeadlineUpdate",
    label: "Изменения срока выполнения",
    visibilityKey: "ticketDeadlineUpdate",
  },
  {
    name: "TicketNewComment",
    label: "Новые комментарии",
    visibilityKey: "ticketNewComment",
  },
  {
    name: "ScheduledWorks",
    label: "Запланированные работы",
    visibilityKey: "scheduledWorks",
  },
];

// На телефоне колонкам хватает только иконок: три подписи в 366 px не встают
const CHANNEL_ICONS = {
  inApp: RiNotification3Line,
  byTelegram: RiTelegramLine,
  byEmail: RiMailLine,
};

// Канал «в приложении» есть у каждого, и у людей, заведённых до него, поля
// нет: отсутствие значит «включено» — как считает и сервер. У почты и
// Telegram сохранённое значение читается как есть.
const channelValue = (notify, channel, key) =>
  channel === "inApp"
    ? notify.inApp?.[key] !== false
    : !!notify[channel]?.[key];

const valueKey = (channel, category) => `${channel}:${category.name}`;

const channelHeader = ({ key, label }) => {
  const Icon = CHANNEL_ICONS[key];
  return (
    <span
      key={key}
      className="flex w-24 flex-none items-center justify-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase max-md:w-14"
    >
      <span className="max-md:hidden">{label}</span>
      <Icon size={16} aria-label={label} className="md:hidden" />
    </span>
  );
};

const Notifications = ({ user, initialPrefs }) => {
  const [values, setValues] = useState(() => {
    const notify = user.notify ?? {};
    const initial = {};
    for (const category of CATEGORIES) {
      for (const { key: channel } of NOTIFY_CHANNELS) {
        initial[valueKey(channel, category)] = channelValue(
          notify,
          channel,
          category.visibilityKey,
        );
      }
    }
    return initial;
  });

  useDraftSection(() => {
    const notify = {};
    for (const { key: channel } of NOTIFY_CHANNELS) {
      notify[channel] = {};
      for (const category of CATEGORIES) {
        notify[channel][category.visibilityKey] =
          !!values[valueKey(channel, category)];
      }
    }
    return { notify };
  });

  const visibleCategories = CATEGORIES.filter(
    (category) =>
      initialPrefs.personalNotifications?.[category.visibilityKey] &&
      (!category.staffOnly || !user.isEndUser),
  );

  const tgDisabled =
    !user.telegramBot?.isActive || !initialPrefs.telegramNotifications;
  const emailDisabled = !initialPrefs.emailNotifications;
  // «В приложении» не выключается никем: транспорта у него нет
  const channelDisabled = { inApp: false, byTelegram: tgDisabled, byEmail: emailDisabled };

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
        hint="Все категории событий выключены — настраивать нечего"
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
        {NOTIFY_CHANNELS.map(channelHeader)}
      </div>
      {visibleCategories.map((category) => (
        <div
          key={category.name}
          className="flex items-center border-t border-border-soft px-5 py-3.5"
        >
          <span className="min-w-0 flex-1 pe-2 text-base">
            {category.label}
          </span>
          {NOTIFY_CHANNELS.map(({ key: channel, label }) => {
            const key = valueKey(channel, category);
            const disabled = channelDisabled[channel];
            return (
              <span
                key={channel}
                className="grid w-24 flex-none place-items-center max-md:w-14"
              >
                <Checkbox
                  className={cn("size-5", disabled && "opacity-40")}
                  checked={values[key]}
                  disabled={disabled}
                  onCheckedChange={() => toggle(key)}
                  aria-label={`${category.label} — ${label}`}
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
