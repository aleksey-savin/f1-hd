import { useEffect, useState } from "react";
import { Form as RouterForm } from "react-router";
import { RiUserFollowLine, RiUserUnfollowLine } from "react-icons/ri";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import { toDateInputValue } from "@/util/format-date";

/**
 * Включить или отключить человека.
 *
 * Отключение спрашивает ПРИЧИНУ и СРОК. Причина — потому что через месяц никто
 * не помнит, за что человек отключён, а карточка была единственным местом, где
 * это можно было бы прочитать, и не показывала ничего. Срок — потому что
 * временное отключение иначе приходится помнить и снимать руками; с датой оно
 * снимается само.
 *
 * Оба поля необязательны: «отключить прямо сейчас и без объяснений» — реальный
 * сценарий (увольнение день в день), и требовать заполнения значило бы мешать
 * там, где надо действовать быстро.
 *
 * Шлёт intent=toggle-active на action карточки. Диалог закрываем на сабмите —
 * иначе модальный radix оставляет залипший pointer-events при редиректе.
 */
const ToggleActiveDialog = ({ user, open, onOpenChange }) => {
  // `banned` вместо `isActive`: полярность обратная, отсутствие поля = работает
  const isActive = !user.banned;
  const Icon = isActive ? RiUserUnfollowLine : RiUserFollowLine;

  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("forever");
  const [until, setUntil] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setMode("forever");
    // Неделя — самый частый временный случай (отпуск, разбирательство), и она
    // же подсказывает формат поля.
    setUntil(toDateInputValue(new Date(Date.now() + 7 * 24 * 3600 * 1000)));
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <RouterForm method="post" onSubmit={() => onOpenChange(false)}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? "Отключить пользователя?" : "Включить пользователя?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? "Открытые сеансы завершатся сразу — на всех устройствах."
                : "Доступ к системе будет восстановлен, причина и срок сотрутся."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isActive && (
            <div className="mt-4 flex flex-col gap-3.5">
              <Field
                label="Причина"
                htmlFor="ban-reason"
                className="mb-0"
                hint="Увидит тот, кто откроет карточку. Человеку не показывается."
              >
                <Input
                  id="ban-reason"
                  name="banReason"
                  autoFocus
                  placeholder="Например, «уволен, передал дела»"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>

              <Field label="До какого времени" className="mb-0">
                <div className="flex flex-col gap-2.5">
                  <Segmented
                    ariaLabel="Срок отключения"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "forever", label: "Бессрочно" },
                      { value: "until", label: "На срок" },
                    ]}
                  />
                  {mode === "until" && (
                    <Input
                      type="date"
                      name="banExpires"
                      aria-label="Дата окончания"
                      value={until}
                      onChange={(event) => setUntil(event.target.value)}
                    />
                  )}
                </div>
              </Field>
            </div>
          )}

          <input type="hidden" name="id" value={user._id} readOnly />
          <input
            type="hidden"
            name="banned"
            value={isActive ? "true" : "false"}
            readOnly
          />

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
            <Button
              variant={isActive ? "warning" : "success"}
              type="submit"
              name="intent"
              value="toggle-active"
            >
              <Icon /> {isActive ? "Отключить" : "Включить"}
            </Button>
          </AlertDialogFooter>
        </RouterForm>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ToggleActiveDialog;
