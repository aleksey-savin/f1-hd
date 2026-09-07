import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";

import Combobox, { toOptions } from "@/components/app/Combobox";
import timezones from "../../../store/timezones";
import { orgTimezone, tzCity } from "../../../util/timezone-display";
import MapLinkHint from "../MapLinkHint";

// Форма подразделения (создание/правка) в диалоге: полей мало, это справочный
// под-объект карточки. Сабмит — прежний intent add/updateSubdivision на action
// /companies/:id; успех закрывает диалог секцией (fetcher общий).
const SubdivisionFormDialog = ({
  open,
  onOpenChange,
  company,
  node,
  parentPreset,
  parentOptions,
  fetcher,
}) => {
  const isEdit = Boolean(node);
  const [parent, setParent] = useState(null);
  const [timezone, setTimezone] = useState(null);
  // Ссылка на карту — контролируемая ради подсказки «есть ли точка»
  const [linkToMap, setLinkToMap] = useState("");

  // Родитель — предустановка на каждое открытие: у правки — текущий родитель,
  // у «Вложенного» — узел-источник.
  useEffect(() => {
    if (open) setParent(parentPreset || null);
  }, [open, parentPreset]);

  // Пустой пояс = «наследовать» (родитель → компания → организация). Копию
  // унаследованного значения не проставляем: филиал переедет — она протухнет.
  useEffect(() => {
    if (!open) return;
    setTimezone(node?.timezone || null);
    setLinkToMap(node?.linkToMap || "");
  }, [open, node]);

  // Что подставится, если поле оставить пустым: пояс выбранного родителя,
  // иначе компании, иначе организации
  const inheritedZone =
    parent?.clientTimezone?.timezone || company?.timezone || orgTimezone();

  const busy = fetcher.state !== "idle";

  const handleSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    formData.append("intent", isEdit ? "updateSubdivision" : "addSubdivision");
    if (isEdit) formData.append("subdivisionId", node._id);
    formData.append("companyId", company._id);
    fetcher.submit(formData, {
      method: "PUT",
      action: `/companies/${company._id}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Изменить подразделение" : "Новое подразделение"}
          </DialogTitle>
        </DialogHeader>

        {fetcher.data?.error && (
          <AlertMessage variant="danger" message={fetcher.data.error} />
        )}

        <form onSubmit={handleSubmit}>
          <Field label="Название" required>
            <Input name="name" required defaultValue={node?.name || ""} />
          </Field>
          <div className="grid gap-x-3.5 md:grid-cols-2">
            <Field label="Email">
              <Input
                type="email"
                name="email"
                defaultValue={node?.email || ""}
              />
            </Field>
            <Field label="Телефон">
              <Input name="phone" defaultValue={node?.phone || ""} />
            </Field>
          </div>
          <Field label="Адрес">
            <Input name="address" defaultValue={node?.address || ""} />
          </Field>
          <Field label="Ссылка на карту" hint={<MapLinkHint url={linkToMap} />}>
            <Input
              name="linkToMap"
              value={linkToMap}
              onChange={(event) => setLinkToMap(event.target.value)}
            />
          </Field>
          <Field label="Родительское подразделение">
            <Combobox
              ariaLabel="Родительское подразделение"
              placeholder="Верхний уровень"
              options={toOptions(parentOptions, {
                value: (option) => String(option._id),
                label: (option) => option.name?.trim() || "Без названия",
              })}
              value={parent?._id ? String(parent._id) : null}
              onChange={(id) =>
                setParent(
                  parentOptions.find((option) => String(option._id) === id) ||
                    null,
                )
              }
              disabled={parentOptions.length === 0}
              clearable
              clearLabel="Верхний уровень"
            />
            <input type="hidden" name="parentId" value={parent?._id || ""} />
          </Field>
          <Field
            label="Часовой пояс"
            hint={
              timezone
                ? "В нём живёт филиал: по нему считается его рабочее время и подсказка «который час у клиента»."
                : `Пусто — как ${parent ? "у родительского подразделения" : "у компании"}: ${tzCity(inheritedZone)}.`
            }
          >
            <Combobox
              ariaLabel="Часовой пояс подразделения"
              placeholder={`Как ${parent ? "у родительского" : "у компании"} — ${tzCity(inheritedZone)}`}
              options={timezones}
              value={timezone}
              onChange={setTimezone}
              clearable
              clearLabel={`Как ${parent ? "у родительского" : "у компании"} — ${tzCity(inheritedZone)}`}
            />
            <input type="hidden" name="timezone" value={timezone || ""} />
          </Field>

          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SubdivisionFormDialog;
