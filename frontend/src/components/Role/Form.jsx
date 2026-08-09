import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import AlertMessage from "@/components/app/AlertMessage";
import PermissionModules from "@/components/User/PermissionModules";
import { ALL_PERMISSION_KEYS } from "@/components/User/permissions-catalog";
import { PERMISSION_OPTIONS } from "@/components/Role/permission-options";
import { api, ApiError } from "@/lib/api";
import { useAuthedUser } from "@/store/authed-user";
import useOffcanvasStore from "@/store/offcanvas";
import useToastStore from "@/store/toast-store";
import useRolesFilterStore from "@/store/lists/roles";

/**
 * Форма роли.
 *
 * Собрана под главный сценарий — открыть готовую роль и добавить одно право;
 * создание с нуля бывает много реже. Отсюда три вещи, которых нет в обычной
 * форме: носители под названием, счётчики «N из M» в шапках карточек как
 * навигация по двадцати девяти правам и блок «что изменится» перед кнопкой.
 *
 * Матрица прав — общий `PermissionModules`, тот же, что в форме человека.
 */

const label = (key) =>
  PERMISSION_OPTIONS.find((option) => option.value === key)?.label ?? key;

const peopleWord = (count) => {
  const tail = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  if (!teen && tail === 1) return "человека";
  return "человек";
};

/** Носители роли: пока их немного — поимённо, дальше только число. */
const Bearers = ({ usage }) => {
  const total = usage?.total || 0;
  if (!total) return null;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-accent/45 px-3 py-2.5 text-sm">
      <span className="font-semibold tabular-nums">
        {total} {peopleWord(total)}
      </span>
      {usage.names?.length ? (
        <span className="min-w-0 truncate text-muted-foreground">
          · {usage.names.join(", ")}
          {total > usage.names.length && " и другие"}
        </span>
      ) : null}
    </div>
  );
};

const RoleForm = ({ role }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const filterStore = useRolesFilterStore();
  // Свои права нужны плоской картой: галочки идут парами «ключ — подпись».
  const { permissions: own } = useAuthedUser();

  const initial = role?.permissions || {};
  const [title, setTitle] = useState(role?.title || "");
  const [description, setDescription] = useState(role?.description || "");
  // Новая роль по умолчанию сотруднику: клиентских ролей в каталоге три, и
  // заводят их редко.
  const [audience, setAudience] = useState(role?.audience || "staff");
  const [permissions, setPermissions] = useState({ ...initial });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    offcanvas.setHide();
    navigate("/roles");
  };

  const toggle = (key) =>
    setPermissions((current) => ({ ...current, [key]: !current[key] }));

  // Что изменится против сохранённого состояния. Считается от исходной роли,
  // а не от пустоты: при создании блок не рисуется вовсе.
  const diff = useMemo(() => {
    if (!role) return { added: [], removed: [] };
    const added = [];
    const removed = [];
    for (const key of ALL_PERMISSION_KEYS) {
      const was = Boolean(initial[key]);
      const now = Boolean(permissions[key]);
      if (was === now) continue;
      (now ? added : removed).push(key);
    }
    return { added, removed };
  }, [role, initial, permissions]);

  const changed = diff.added.length > 0 || diff.removed.length > 0;
  const total = role?.usage?.total || 0;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body = { title, description, permissions, audience };
      if (role) {
        await api(`/api/roles/${role.key}`, { method: "PATCH", body });
      } else {
        await api("/api/roles", { method: "POST", body });
      }
      await filterStore.fetch();
      filterStore.applyFilter();
      useToastStore
        .getState()
        .showToast("success", role ? "Роль сохранена" : "Роль создана");
      close();
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Не удалось сохранить роль",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      <h2 className="my-0 text-2xl font-semibold tracking-tight">
        {role ? role.title : "Новая роль"}
      </h2>

      {error && <AlertMessage variant="danger" message={error} />}

      {/* У новой роли носителей нет — пустая плашка «0 человек» была бы шумом
          на самом видном месте. */}
      {role && <Bearers usage={role.usage} />}

      <Field
        label="Название"
        htmlFor="role-title"
        required
        className="mb-0"
        hint={
          role
            ? "Меняется свободно: у роли есть неизменяемый ключ, по которому живут назначения"
            : undefined
        }
      >
        <Input
          id="role-title"
          autoFocus
          placeholder="Например, «Инженер выездной»"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <Field label="Описание" htmlFor="role-description" className="mb-0">
        <Textarea
          id="role-description"
          rows={2}
          placeholder="Зачем эта роль — увидят те, кто будет её назначать"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <Field
        label="Кому назначается"
        className="mb-0"
        hint="Тип аккаунта человека решает, какие роли предложить первыми. Роль другого адресата выбрать всё равно можно — она просто уйдёт вниз списка."
      >
        <Segmented
          ariaLabel="Кому назначается"
          value={audience}
          onChange={setAudience}
          options={[
            { value: "staff", label: "Сотрудникам" },
            { value: "client", label: "Клиентам" },
          ]}
        />
      </Field>

      <PermissionModules
        values={permissions}
        onToggle={toggle}
        // Право, которого нет у самого, выдать нельзя — сервер отобьёт.
        // Предлагать то, что вернётся отказом, хуже, чем не предлагать.
        allowed={own}
      />

      {/* Последствие названо ДО нажатия: тост «Роль сохранена» приходит, когда
          менять что-то поздно. */}
      {changed && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="bg-accent/45 px-3 py-2 text-xs font-semibold tracking-wider text-faint uppercase">
            Что изменится
          </div>
          <div className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
            {diff.added.map((key) => (
              <div key={key} className="font-semibold text-accent-text">
                + {label(key)}
              </div>
            ))}
            {diff.removed.map((key) => (
              <div key={key} className="font-semibold text-destructive">
                − {label(key)}
              </div>
            ))}
            <div className="text-muted-foreground">
              {total
                ? `Затронет ${total} ${peopleWord(total)} — сразу, без перезахода.`
                : "Роль никому не назначена — на людей это пока не влияет."}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" type="button" onClick={close}>
          Отмена
        </Button>
        <Button onClick={submit} disabled={busy || !title.trim()}>
          {role ? "Сохранить" : "Создать роль"}
        </Button>
      </div>
    </div>
  );
};

export default RoleForm;
