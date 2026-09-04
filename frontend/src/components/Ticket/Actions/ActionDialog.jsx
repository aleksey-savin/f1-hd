import { useEffect, useState } from "react";

import { RiCloseLine, RiErrorWarningLine } from "react-icons/ri";

import Combobox from "@/components/app/Combobox";
import DateTimeField from "@/components/app/DateTimeField";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import useTicketAction from "../../../hooks/use-ticket-action";
import { localToUtc, utcToLocalForm } from "../../../util/format-date";
import { closeBlockers } from "../ticket-actions";
import { useCan } from "@/store/authed-user";

/**
 * Диалоги действий над заявкой — одним компонентом вместо семи почти одинаковых
 * модалок: у всех общая механика (fetcher на action маршрута заявки,
 * `expectedVersion` для оптимистичной блокировки, закрытие по сабмиту), а
 * различаются только поле и подпись.
 *
 * «Обработать» сюда не входит: это полноценная форма заявки, она переезжает
 * вместе с формами (этап «Формы заявки»).
 */

const TITLES = {
  takeToWork: "Принять в работу",
  join: "Присоединиться к работе",
  close: "Закрыть заявку",
  backToWork: "Вернуть заявку в работу",
  requestHelp: "Запросить помощь",
  updateDeadline: "Изменить срок",
  reject: "Отказаться от заявки",
};

// Кнопка диалога называет само действие, а не «Сохранить»: это подтверждение
// операции, а не форма сущности, — и результат называется тем же словом
// («Присоединиться» → «Вы в ответственных»). Тот же канон у диалога удаления.
const SUBMIT = {
  takeToWork: "Принять",
  join: "Присоединиться",
  close: "Закрыть заявку",
  backToWork: "Вернуть в работу",
  requestHelp: "Запросить",
  updateDeadline: "Изменить срок",
  reject: "Отказаться",
};

const personName = (person) =>
  `${person?.lastName ?? ""} ${person?.firstName ?? ""}`.trim();

const personNames = (people = []) =>
  people.map(personName).filter(Boolean).join(", ");

const ActionDialog = ({
  action,
  ticket,
  works = [],
  responsibles = [],
  onClose,
  onFixWorks,
}) => {
  // useTicketAction, а не голый useFetcher: 409 (устаревшая версия) и 422
  // (правило процесса) сервер называет словами — обёртка показывает их тостом
  const fetcher = useTicketAction();
  const can = useCan();
  const [takeOver, setTakeOver] = useState(false);
  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [helpers, setHelpers] = useState([]);

  const open = Boolean(action);

  useEffect(() => {
    if (!open) return;
    setTakeOver(false);
    setText("");
    setHelpers([]);
    setDeadline(ticket?.deadline ? utcToLocalForm(ticket.deadline) : "");
  }, [open, action, ticket]);

  // Закрываем по завершении сабмита: данные перечитает ревалидация роутера
  useEffect(() => {
    if (open && fetcher.state === "idle" && fetcher.data !== undefined) {
      onClose();
    }
  }, [fetcher.state, fetcher.data]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    const base = {
      _id: ticket._id,
      expectedVersion: ticket.version ?? "",
    };
    const payload = {
      takeToWork: { intent: "takeToWork", ...base, takeOver },
      join: { intent: "join", ...base },
      close: { intent: "close", ...base, closingComment: text },
      backToWork: { intent: "backToWork", ...base, returningComment: text },
      requestHelp: {
        intent: "requestHelp",
        ...base,
        responsibles: JSON.stringify(helpers),
      },
      updateDeadline: {
        intent: "updateDeadline",
        ...base,
        // Настенное время в бизнес-таймзоне — пара к utcToLocalForm
        deadline: deadline ? localToUtc(deadline) : "",
      },
      reject: { intent: "reject", ...base, rejectDesc: text },
    }[action];

    fetcher.submit(payload, {
      method: "POST",
      action: `/tickets/${ticket.num}`,
    });
    onClose();
  };

  const busy = fetcher.state !== "idle";
  // Закрытие держат те же правила, что и раньше: без работ его не примет и
  // бэкенд, а обязательные пункты чек-листа — договорённость процесса
  const blockers =
    action === "close" ? closeBlockers(ticket, { works, can }) : [];
  const noWorks = blockers[0] === "По заявке не указаны работы";

  // Кого можно позвать: те, кто ведёт заявки, минус уже ответственные и минус
  // уже выбранные — повторно позвать одного и того же нельзя
  const busyIds = new Set([
    ...(ticket.responsibles ?? []).map((user) => user._id?.toString()),
    ...helpers.map((user) => user._id?.toString()),
  ]);
  const helperOptions = responsibles
    .filter((user) => !busyIds.has(user._id?.toString()))
    .map((user) => ({
      value: user._id,
      label: personName(user),
      hint: user.position || undefined,
    }));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={action === "close" ? "sm:max-w-2xl" : undefined}
      >
        <form onSubmit={submit}>
          {/* Ни темы, ни номера: карточка заявки осталась на фоне, и диалогу
              незачем повторять то, что человек только что читал */}
          <DialogHeader>
            <DialogTitle>{TITLES[action]}</DialogTitle>
          </DialogHeader>

          <div className="mt-3">
            {action === "takeToWork" && (
              <>
                <SwitchField
                  id="action-take-over"
                  label="Взять на себя"
                  hint="Остальные ответственные будут сняты с заявки"
                  checked={takeOver}
                  onCheckedChange={setTakeOver}
                />
                {takeOver && (
                  <Alert variant="warning">
                    <AlertDescription>
                      После сохранения вы останетесь единственным ответственным.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {action === "join" && (
              <p className="my-0 text-sm text-muted-foreground">
                Вы будете добавлены к ответственным и начнёте получать
                уведомления по заявке.
              </p>
            )}

            {action === "close" && blockers.length > 0 && (
              <Alert variant="warning">
                <RiErrorWarningLine />
                <AlertDescription>
                  <span>Заявку пока нельзя закрыть:</span>
                  <ul className="my-0 list-disc ps-4">
                    {blockers.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {action === "close" && blockers.length === 0 && (
              <>
                <Field
                  label="Результат выполнения"
                  htmlFor="action-text"
                  required
                >
                  <Textarea
                    id="action-text"
                    rows={4}
                    required
                    autoFocus
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Например: Добрый день! Проблема устранена."
                  />
                </Field>
                <Alert variant="warning">
                  <AlertDescription>
                    <ul className="my-0 list-disc ps-4">
                      <li>Сообщение уйдёт инициатору заявки.</li>
                      <li>
                        Из ответственных будут удалены те, кто не указал работы
                        и не имеет разрешения их не указывать.
                      </li>
                    </ul>
                  </AlertDescription>
                </Alert>
              </>
            )}

            {action === "backToWork" && (
              <Field label="Причина возврата" htmlFor="action-text" required>
                <Textarea
                  id="action-text"
                  rows={3}
                  required
                  autoFocus
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </Field>
            )}

            {action === "reject" && (
              <Field label="Причина отказа" htmlFor="action-text" required>
                <Textarea
                  id="action-text"
                  rows={3}
                  required
                  autoFocus
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </Field>
            )}

            {action === "updateDeadline" && (
              <Field label="Срок" htmlFor="action-deadline">
                <DateTimeField
                  id="action-deadline"
                  value={deadline}
                  onChange={setDeadline}
                />
              </Field>
            )}

            {/* Запрос помощи только ДОБАВЛЯЕТ ответственных — так же работает и
                бэкенд (`requestHelp` конкатенирует). Прежний мультиселект был
                заполнен текущими ответственными, и снятая в нём галочка ничего
                не меняла: интерфейс обещал то, чего не делает. */}
            {action === "requestHelp" && (
              <>
                <div className="mb-4 text-sm">
                  <span className="text-muted-foreground">
                    Сейчас ведут заявку:{" "}
                  </span>
                  {personNames(ticket.responsibles) || "никто"}
                </div>

                <Field
                  label="Кого добавить"
                  htmlFor="action-helpers"
                  hint="Добавленные получат уведомление о заявке. Текущие ответственные останутся."
                >
                  <Combobox
                    id="action-helpers"
                    value={null}
                    placeholder="Выберите коллегу"
                    emptyText="Все подходящие уже в заявке."
                    options={helperOptions}
                    onChange={(id) => {
                      const user = responsibles.find(
                        (person) => person._id === id,
                      );
                      if (user) setHelpers((prev) => [...prev, user]);
                    }}
                  />
                  {helpers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {helpers.map((user) => (
                        <span
                          key={user._id}
                          className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-accent py-0.5 ps-2.5 pe-1 text-sm font-medium"
                        >
                          {personName(user)}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Убрать ${personName(user)}`}
                            className="size-5 text-faint hover:text-destructive"
                            onClick={() =>
                              setHelpers((prev) =>
                                prev.filter(
                                  (person) => person._id !== user._id,
                                ),
                              )
                            }
                          >
                            <RiCloseLine />
                          </Button>
                        </span>
                      ))}
                    </div>
                  )}
                </Field>
              </>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {blockers.length > 0 ? "Закрыть" : "Отмена"}
            </Button>
            {blockers.length > 0 ? (
              noWorks &&
              onFixWorks && (
                <Button
                  type="button"
                  onClick={() => {
                    onClose();
                    onFixWorks();
                  }}
                >
                  Указать работы
                </Button>
              )
            ) : (
              <Button
                type="submit"
                disabled={
                  busy || (action === "requestHelp" && helpers.length === 0)
                }
              >
                {busy ? "Выполняем…" : SUBMIT[action]}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ActionDialog;
