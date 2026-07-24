import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";

import SectionForm from "./SectionForm";

// «Уведомления»: глобальные рубильники категорий событий, повторы при ошибке
// отправки и каналы (SMTP, Telegram). Канал Telegram включает единую группу
// команды: chatId и ветка (messageThreadId) общие для групповых уведомлений и
// табло статусов; смена группы/ветки на бэкенде сбрасывает закреп табло — бот
// пересоздаст его. Имя категории едино в трёх местах (prefs.notify.personal.X
// ↔ user.notify.*) — конвенция новых категорий описана в ux-ui-guide
// («Мой аккаунт»).
const CATEGORIES = [
  { key: "newTicket", label: "Новая заявка" },
  { key: "respStateUpdate", label: "Изменение статуса ответственного" },
  { key: "ticketStateUpdate", label: "Изменение статуса заявки" },
  { key: "ticketDeadlineUpdate", label: "Изменение срока заявки" },
  { key: "ticketNewComment", label: "Новые комментарии к заявке" },
  { key: "scheduledWorks", label: "Запланированные работы" },
];

const PrefsNotifications = ({ prefs }) => {
  const [notify, setNotify] = useState(() => ({
    personal: { ...(prefs.notify?.personal || {}) },
    byEmail: { ...(prefs.notify?.byEmail || {}) },
    byTelegram: { ...(prefs.notify?.byTelegram || {}) },
  }));
  const [statusBoardOn, setStatusBoardOn] = useState(
    !!prefs.statusBoard?.isActive,
  );

  const patch = (group, key, value) =>
    setNotify((current) => ({
      ...current,
      [group]: { ...current[group], [key]: value },
    }));

  const buildPayload = () => ({
    notify: {
      personal: notify.personal,
      byEmail: {
        ...notify.byEmail,
        port: Number(notify.byEmail.port) || 465,
      },
      byTelegram: {
        isActive: !!notify.byTelegram.isActive,
        sendToGroup: !!notify.byTelegram.sendToGroup,
        chatId: notify.byTelegram.chatId || "",
        messageThreadId: notify.byTelegram.messageThreadId || "",
      },
    },
    statusBoard: { isActive: statusBoardOn },
  });

  const emailOn = !!notify.byEmail.isActive;
  const telegramOn = !!notify.byTelegram.isActive;
  const dimEmail = emailOn ? "tw:py-3" : "tw:py-3 tw:opacity-60";
  const dimTelegram = telegramOn ? "tw:py-3" : "tw:py-3 tw:opacity-60";

  return (
    <SectionForm buildPayload={buildPayload}>
      <div className="tw:px-5 tw:pt-4">
        <SubLabel>Категории событий</SubLabel>
        <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">
          Выключенная категория исчезает из личных настроек сотрудников.
        </p>
      </div>
      {CATEGORIES.map(({ key, label }) => (
        <SettingRow
          key={key}
          title={label}
          htmlFor={`prefs-cat-${key}`}
          className="tw:py-3"
        >
          <Switch
            id={`prefs-cat-${key}`}
            checked={!!notify.personal[key]}
            onCheckedChange={(value) => patch("personal", key, value)}
          />
        </SettingRow>
      ))}

      <div className="tw:px-5 tw:pt-4">
        <SubLabel>Канал: почта (SMTP)</SubLabel>
      </div>
      <SettingRow
        title="Отправлять почтовые уведомления"
        htmlFor="prefs-email-enabled"
        className="tw:py-3"
      >
        <Switch
          id="prefs-email-enabled"
          checked={emailOn}
          onCheckedChange={(value) => patch("byEmail", "isActive", value)}
        />
      </SettingRow>
      <SettingRow
        title="SMTP-сервер и порт"
        htmlFor="prefs-smtp-host"
        className={dimEmail}
      >
        <div className="tw:flex tw:items-center tw:gap-2 tw:max-md:flex-col tw:max-md:items-stretch">
          <Input
            id="prefs-smtp-host"
            type="text"
            disabled={!emailOn}
            value={notify.byEmail.host || ""}
            onChange={(event) => patch("byEmail", "host", event.target.value)}
            className="tw:w-56 tw:max-md:w-full"
          />
          <Input
            type="number"
            disabled={!emailOn}
            value={notify.byEmail.port ?? 465}
            onChange={(event) => patch("byEmail", "port", event.target.value)}
            className="tw:w-24 tw:text-right tw:max-md:w-full"
            aria-label="Порт SMTP-сервера"
          />
        </div>
      </SettingRow>
      <SettingRow
        title="SSL/TLS шифрование"
        htmlFor="prefs-smtp-secure"
        className={dimEmail}
      >
        <Switch
          id="prefs-smtp-secure"
          disabled={!emailOn}
          checked={!!notify.byEmail.isSecure}
          onCheckedChange={(value) => patch("byEmail", "isSecure", value)}
        />
      </SettingRow>
      <SettingRow
        title="Имя пользователя"
        htmlFor="prefs-smtp-user"
        className={dimEmail}
      >
        <Input
          id="prefs-smtp-user"
          type="text"
          disabled={!emailOn}
          value={notify.byEmail.user || ""}
          onChange={(event) => patch("byEmail", "user", event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Пароль" htmlFor="prefs-smtp-pass" className={dimEmail}>
        <Input
          id="prefs-smtp-pass"
          type="password"
          disabled={!emailOn}
          value={notify.byEmail.pass || ""}
          onChange={(event) => patch("byEmail", "pass", event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
          autoComplete="new-password"
        />
      </SettingRow>
      <SettingRow
        title="Отправитель"
        hint="Имя и адрес в поле «От кого»."
        htmlFor="prefs-smtp-from-name"
        className={dimEmail}
      >
        <div className="tw:flex tw:items-center tw:gap-2 tw:max-md:flex-col tw:max-md:items-stretch">
          <Input
            id="prefs-smtp-from-name"
            type="text"
            disabled={!emailOn}
            placeholder="Имя"
            value={notify.byEmail.sendFromName || ""}
            onChange={(event) =>
              patch("byEmail", "sendFromName", event.target.value)
            }
            className="tw:w-40 tw:max-md:w-full"
          />
          <Input
            type="text"
            disabled={!emailOn}
            placeholder="Email"
            value={notify.byEmail.sendFromEmail || ""}
            onChange={(event) =>
              patch("byEmail", "sendFromEmail", event.target.value)
            }
            className="tw:w-56 tw:max-md:w-full"
            aria-label="Email отправителя"
          />
        </div>
      </SettingRow>

      <div className="tw:px-5 tw:pt-4">
        <SubLabel>Канал: Telegram</SubLabel>
      </div>
      <SettingRow
        title="Отправлять Telegram-уведомления"
        hint="Личные сообщения от бота."
        htmlFor="prefs-tg-enabled"
        className="tw:py-3"
      >
        <Switch
          id="prefs-tg-enabled"
          checked={telegramOn}
          onCheckedChange={(value) => patch("byTelegram", "isActive", value)}
        />
      </SettingRow>
      <SettingRow
        title="Chat ID группы"
        hint="Рабочая группа команды: сюда приходят групповые уведомления и табло статусов."
        htmlFor="prefs-tg-chat"
        className={dimTelegram}
      >
        <Input
          id="prefs-tg-chat"
          type="text"
          disabled={!telegramOn}
          value={notify.byTelegram.chatId || ""}
          onChange={(event) => patch("byTelegram", "chatId", event.target.value)}
          className="tw:w-56 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow
        title="ID ветки (топика)"
        hint="Для форум-групп: уведомления и табло — в эту ветку; пусто — General. Можно задать командой /status_board в нужной ветке."
        htmlFor="prefs-tg-thread"
        className={dimTelegram}
      >
        <Input
          id="prefs-tg-thread"
          type="text"
          disabled={!telegramOn}
          value={notify.byTelegram.messageThreadId || ""}
          onChange={(event) =>
            patch("byTelegram", "messageThreadId", event.target.value)
          }
          className="tw:w-40 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow
        title="Отправлять уведомления в группу"
        hint="События заявок — в общий чат, помимо личных сообщений."
        htmlFor="prefs-tg-to-group"
        className={dimTelegram}
      >
        <Switch
          id="prefs-tg-to-group"
          disabled={!telegramOn}
          checked={!!notify.byTelegram.sendToGroup}
          onCheckedChange={(value) => patch("byTelegram", "sendToGroup", value)}
        />
      </SettingRow>
      <SettingRow
        title="Публиковать табло статусов"
        hint="Бот держит в группе одно закреплённое сообщение со статусами присутствия сотрудников и редактирует его."
        htmlFor="prefs-status-board"
        className={dimTelegram}
      >
        <Switch
          id="prefs-status-board"
          disabled={!telegramOn}
          checked={statusBoardOn}
          onCheckedChange={setStatusBoardOn}
        />
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsNotifications;
