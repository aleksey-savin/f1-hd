import { useContext, useState } from "react";

import { RiMailSendLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import HealthRow from "@/components/app/HealthRow";
import { SubLabel } from "@/components/app/Panel";

import { AuthedUserContext } from "../../store/authed-user-context";
import SectionForm from "./SectionForm";
import MailChannelFields from "./MailChannelFields";
import { describeChannelHealth, describeCheckResult } from "./channel-health";

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
  // Категории появлялись в моделях, но в эту матрицу не попадали — глобальный
  // выключатель у них есть, а включить его было негде
  { key: "absenceRequest", label: "Запрос на отсутствие" },
  { key: "absenceDecision", label: "Решение по отсутствию" },
  { key: "reportApproval", label: "Отчёт на согласование" },
  { key: "reportDecision", label: "Решение по отчёту" },
];

const PrefsNotifications = ({ prefs }) => {
  const authedUser = useContext(AuthedUserContext);
  const [notify, setNotify] = useState(() => ({
    personal: { ...(prefs.notify?.personal || {}) },
    // Транспорт канала общий с ящиком-приёмником, поэтому и здесь секрет зовётся
    // password — в payload он уходит как pass (имя поля в модели не меняли:
    // notify.byEmail читают getAuth, getInitial и telegram-bot)
    byEmail: {
      ...(prefs.notify?.byEmail || {}),
      security: prefs.notify?.byEmail?.security || "ssl",
      authMethod: prefs.notify?.byEmail?.authMethod || "password",
      password: "",
    },
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

  const patchEmail = (values) =>
    setNotify((current) => ({
      ...current,
      byEmail: { ...current.byEmail, ...values },
    }));

  // Перечисляем поля явно: health и флаг passIsSet принадлежат серверу и не
  // должны уезжать обратно (иначе сохранение затрёт состояние канала).
  const buildEmailPayload = () => ({
    isActive: !!notify.byEmail.isActive,
    host: notify.byEmail.host || "",
    port: Number(notify.byEmail.port) || 465,
    security: notify.byEmail.security || "ssl",
    allowSelfSigned: !!notify.byEmail.allowSelfSigned,
    authMethod: notify.byEmail.authMethod || "password",
    user: notify.byEmail.user || "",
    pass: notify.byEmail.password || "",
    sendFromName: notify.byEmail.sendFromName || "",
    sendFromEmail: notify.byEmail.sendFromEmail || "",
  });

  const buildPayload = () => ({
    notify: {
      personal: notify.personal,
      byEmail: buildEmailPayload(),
      byTelegram: {
        isActive: !!notify.byTelegram.isActive,
        sendToGroup: !!notify.byTelegram.sendToGroup,
        chatId: notify.byTelegram.chatId || "",
        messageThreadId: notify.byTelegram.messageThreadId || "",
      },
    },
    statusBoard: { isActive: statusBoardOn },
  });

  // Проверка канала — реальной отправкой: успешный коннект к SMTP ещё не значит,
  // что письмо примут. Адресат — тот, кто нажал кнопку.
  const [sending, setSending] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const testTarget = authedUser?.email;
  const testHint = testTarget
    ? `Тестовое письмо уйдёт на ${testTarget}`
    : "Тестовое письмо уйдёт на адрес вашей учётной записи";

  const sendTestEmail = async () => {
    setSending(true);
    setTestResult(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/preferences/smtp/test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ byEmail: buildEmailPayload() }),
        },
      );
      if (!response.ok) throw new Error();
      setTestResult(await response.json());
    } catch {
      setTestResult({
        ok: false,
        state: "Не удалось выполнить проверку",
        hint: "Сервер приложения не ответил — попробуйте ещё раз.",
      });
    } finally {
      setSending(false);
    }
  };

  const emailOn = !!notify.byEmail.isActive;
  const telegramOn = !!notify.byTelegram.isActive;
  const dimEmail = emailOn ? "py-3" : "py-3 opacity-60";
  const dimTelegram = telegramOn ? "py-3" : "py-3 opacity-60";

  const emailHealth = sending
    ? { state: "busy", title: "Отправляем письмо…" }
    : testResult
      ? describeCheckResult(testResult, { hint: testHint })
      : describeChannelHealth(prefs.notify?.byEmail?.health, {
          kind: "smtp",
          hint: testHint,
        });

  return (
    <SectionForm buildPayload={buildPayload}>
      <div className="px-5 pt-4">
        <SubLabel>Категории событий</SubLabel>
        <p className="my-0 text-sm text-muted-foreground">
          Выключенная категория исчезает из личных настроек сотрудников.
        </p>
      </div>
      {CATEGORIES.map(({ key, label }) => (
        <SettingRow
          key={key}
          title={label}
          htmlFor={`prefs-cat-${key}`}
          className="py-3"
        >
          <Switch
            id={`prefs-cat-${key}`}
            checked={!!notify.personal[key]}
            onCheckedChange={(value) => patch("personal", key, value)}
          />
        </SettingRow>
      ))}

      <div className="px-5 pt-4">
        <SubLabel>Канал: почта (SMTP)</SubLabel>
      </div>
      <SettingRow
        title="Отправлять почтовые уведомления"
        htmlFor="prefs-email-enabled"
        className="py-3"
      >
        <Switch
          id="prefs-email-enabled"
          checked={emailOn}
          onCheckedChange={(value) => patch("byEmail", "isActive", value)}
        />
      </SettingRow>
      {emailOn && (
        <HealthRow
          {...emailHealth}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={sending}
              onClick={sendTestEmail}
            >
              <RiMailSendLine
                className={sending ? "animate-pulse" : undefined}
              />
              Отправить тестовое письмо
            </Button>
          }
        />
      )}
      <MailChannelFields
        kind="smtp"
        idPrefix="prefs-smtp"
        value={notify.byEmail}
        onChange={patchEmail}
        disabled={!emailOn}
        passwordIsSet={!!prefs.notify?.byEmail?.passIsSet}
        className={dimEmail}
      />
      <SettingRow
        title="Отправитель"
        hint="Имя и адрес в поле «От кого»."
        htmlFor="prefs-smtp-from-name"
        className={dimEmail}
      >
        <div className="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
          <Input
            id="prefs-smtp-from-name"
            type="text"
            disabled={!emailOn}
            placeholder="Имя"
            value={notify.byEmail.sendFromName || ""}
            onChange={(event) =>
              patch("byEmail", "sendFromName", event.target.value)
            }
            className="w-40 max-md:w-full"
          />
          <Input
            type="text"
            disabled={!emailOn}
            placeholder="Email"
            value={notify.byEmail.sendFromEmail || ""}
            onChange={(event) =>
              patch("byEmail", "sendFromEmail", event.target.value)
            }
            className="w-56 max-md:w-full"
            aria-label="Email отправителя"
          />
        </div>
      </SettingRow>

      <div className="px-5 pt-4">
        <SubLabel>Канал: Telegram</SubLabel>
      </div>
      <SettingRow
        title="Отправлять Telegram-уведомления"
        hint="Личные сообщения от бота."
        htmlFor="prefs-tg-enabled"
        className="py-3"
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
          onChange={(event) =>
            patch("byTelegram", "chatId", event.target.value)
          }
          className="w-56 max-md:w-full"
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
          className="w-40 max-md:w-full"
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
