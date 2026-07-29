import { useEffect, useMemo, useState } from "react";

import { RiUserAddLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import Combobox from "@/components/app/Combobox";
import Field from "@/components/app/Field";

import { getLocalStorageData } from "../../util/auth";
import useAssignableUsers, { userOptionLabel } from "./useAssignableUsers";

const refId = (value) => value?._id || value || "";

/**
 * Выдача устройства пользователю — операция, а не правка поля: отдельный
 * эндпоинт (`POST /client-devices/:id/assign-user`) сам переводит статус в
 * «В эксплуатации», а снятие — обратно в «Готово к выдаче». Поэтому действие
 * живёт ярлыком секции «Размещение», а не в форме устройства.
 *
 * Кандидаты и пользователь по умолчанию — по правилам расположения
 * (`useAssignableUsers`): сотрудник рабочего места → сотрудники подразделения
 * → все сотрудники компании.
 */
const AssignUserDialog = ({ open, onOpenChange, device, onAssigned }) => {
  const companyId = refId(device?.companyId);
  const { users, defaultUserId, single } = useAssignableUsers(
    refId(device?.locationId),
    companyId,
  );

  const [userId, setUserId] = useState(refId(device?.userId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setUserId(refId(device?.userId));
    setError("");
  }, [open, device]);

  // Кандидаты подгрузились, а выбор пуст — ставим значение по умолчанию.
  useEffect(() => {
    if (!open) return;
    setUserId((previous) => {
      if (previous) return previous;
      return single && users[0] ? users[0]._id : defaultUserId || "";
    });
  }, [open, users, defaultUserId, single]);

  const options = useMemo(
    () =>
      users.map((user) => ({ value: user._id, label: userOptionLabel(user) })),
    [users],
  );

  const submit = async (nextUserId) => {
    setSaving(true);
    setError("");
    const { token } = getLocalStorageData();
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${device._id}/assign-user`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ userId: nextUserId || "" }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Не удалось назначить пользователя");
      }
      onAssigned?.();
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const hasUser = Boolean(refId(device?.userId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {hasUser ? "Сменить пользователя" : "Выдать пользователю"}
          </DialogTitle>
          <DialogDescription>
            Список и значение по умолчанию зависят от расположения устройства.
            Выдача переведёт статус в «В эксплуатации».
          </DialogDescription>
        </DialogHeader>

        {error && <AlertMessage variant="danger" message={error} />}

        <Field label="Пользователь" htmlFor="assign-user">
          <Combobox
            id="assign-user"
            value={userId || null}
            options={options}
            onChange={(value) => setUserId(value || "")}
            placeholder={
              companyId ? "Выберите пользователя" : "У устройства нет компании"
            }
            searchPlaceholder="Найти сотрудника…"
            emptyText="Нет подходящих пользователей"
            disabled={saving || !companyId}
          />
        </Field>

        <DialogFooter className="tw:sm:justify-between">
          {hasUser ? (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => submit("")}
            >
              Снять пользователя
            </Button>
          ) : (
            <span />
          )}
          <div className="tw:flex tw:gap-2">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button disabled={saving || !userId} onClick={() => submit(userId)}>
              <RiUserAddLine /> {saving ? "Сохраняем…" : "Выдать"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AssignUserDialog;
