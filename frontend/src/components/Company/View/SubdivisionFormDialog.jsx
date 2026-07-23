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
import { InsideOverlayContext } from "@/components/app/overlay-context";

import Select from "../../../UI/Select";

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

  // Родитель — предустановка на каждое открытие: у правки — текущий родитель,
  // у «Вложенного» — узел-источник.
  useEffect(() => {
    if (open) setParent(parentPreset || null);
  }, [open, parentPreset]);

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
      <DialogContent className="tw:max-w-lg" aria-describedby={undefined}>
        <InsideOverlayContext.Provider value={true}>
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
            <div className="tw:grid tw:gap-x-3.5 tw:md:grid-cols-2">
              <Field label="Email">
                <Input type="email" name="email" defaultValue={node?.email || ""} />
              </Field>
              <Field label="Телефон">
                <Input name="phone" defaultValue={node?.phone || ""} />
              </Field>
            </div>
            <Field label="Адрес">
              <Input name="address" defaultValue={node?.address || ""} />
            </Field>
            <Field label="Ссылка на карту">
              <Input name="linkToMap" defaultValue={node?.linkToMap || ""} />
            </Field>
            <Field label="Родительское подразделение">
              <Select
                isClearable
                placeholder="Верхний уровень"
                options={parentOptions}
                value={parent}
                onChange={(next) => setParent(next || null)}
                getOptionLabel={(option) => option.name?.trim() || "Без названия"}
                getOptionValue={(option) => option._id}
                isDisabled={parentOptions.length === 0}
              />
              <input type="hidden" name="parentId" value={parent?._id || ""} />
            </Field>

            <DialogFooter className="tw:mt-1">
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
        </InsideOverlayContext.Provider>
      </DialogContent>
    </Dialog>
  );
};

export default SubdivisionFormDialog;
