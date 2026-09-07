import { useEffect, useMemo, useState } from "react";

import { RiSearchLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import AlertMessage from "@/components/app/AlertMessage";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import useDeviceTypeFilterStore from "@/store/lists/deviceTypes";

import { typesOfAttribute } from "./device-type-links";

// Привязка атрибута к типам устройств набором — обратная сторона «Добавить
// атрибут» на карточке типа, где связки правятся по одной. Отмеченные типы —
// те, где атрибут используется; снятая отметка отвязывает, поэтому она
// подписана словом, а не только пустым квадратом: значения этого атрибута в
// конфигурациях моделей такого типа останутся в базе, но перестанут
// показываться (ровно как при удалении атрибута с карточки типа).
// Поиск появляется, когда каталог перестаёт помещаться в список целиком.
const SEARCH_FROM = 10;

const DeviceTypesDialog = ({ attribute, open, onOpenChange }) => {
  // Селекторами, а не стором целиком: диалог висит на КАЖДОЙ строке списка, и
  // подписка на весь стор перерисовывала бы их все на любое его изменение.
  const deviceTypes = useDeviceTypeFilterStore(
    (state) => state.originalList || [],
  );
  const fetchDeviceTypes = useDeviceTypeFilterStore((state) => state.fetch);

  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const linkedIds = useMemo(
    () => typesOfAttribute(deviceTypes, attribute._id).map((type) => type._id),
    [deviceTypes, attribute._id],
  );

  // Открытие — точка сброса: диалог живёт вместе со строкой и переживает
  // закрытие, поэтому набор и запрос берутся заново из актуального каталога.
  useEffect(() => {
    if (!open) return;
    setSelected(linkedIds);
    setQuery("");
    setError("");
    if (deviceTypes.length === 0) {
      fetchDeviceTypes();
    }
  }, [open]);

  const linkedSet = new Set(linkedIds.map(String));
  const selectedSet = new Set(selected.map(String));

  const added = selected.filter((id) => !linkedSet.has(String(id)));
  const removed = linkedIds.filter((id) => !selectedSet.has(String(id)));
  const changed = added.length > 0 || removed.length > 0;

  const search = query.trim().toLowerCase();
  const visible = search
    ? deviceTypes.filter((type) => type.name.toLowerCase().includes(search))
    : deviceTypes;

  const toggle = (id) =>
    setSelected((current) =>
      current.some((entry) => String(entry) === String(id))
        ? current.filter((entry) => String(entry) !== String(id))
        : [...current, id],
    );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError("");

    try {
      await api(
        `/api/inventory/device-attributes/${attribute._id}/device-types`,
        {
          method: "PUT",
          body: { deviceTypeIds: selected },
        },
      );
      // Колонку типов в строке считает каталог типов — обновляем его, иначе
      // список показывал бы прежнюю привязку до следующей навигации.
      await fetchDeviceTypes();
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError.message || "Не удалось сохранить привязку");
    } finally {
      setIsSaving(false);
    }
  };

  const diff = [
    added.length > 0 && `добавится: ${added.length}`,
    removed.length > 0 && `отвяжется: ${removed.length}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Типы устройств</DialogTitle>
          <DialogDescription>
            Атрибут «{attribute.name}» используется в отмеченных типах.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <AlertMessage variant="danger" message={error} className="mt-0" />
          )}

          {deviceTypes.length > SEARCH_FROM && (
            <div className="relative">
              <RiSearchLine
                size={16}
                aria-hidden
                className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти тип…"
                className="pl-9"
              />
            </div>
          )}

          <div className="max-h-67 overflow-y-auto rounded-lg border border-border">
            {visible.length === 0 ? (
              <p className="my-0 px-3 py-6 text-center text-sm text-muted-foreground">
                {deviceTypes.length === 0
                  ? "Каталог типов пуст."
                  : "Ничего не нашлось."}
              </p>
            ) : (
              visible.map((type) => {
                const isSelected = selectedSet.has(String(type._id));
                const wasLinked = linkedSet.has(String(type._id));
                const willUnlink = wasLinked && !isSelected;
                const willLink = !wasLinked && isSelected;

                return (
                  <label
                    key={type._id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-border-soft px-3 py-2 text-sm transition-colors last:border-b-0 hover:bg-accent"
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(type._id)}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        willUnlink && "text-muted-foreground line-through",
                      )}
                    >
                      {type.name}
                    </span>
                    {willUnlink && (
                      <span className="flex-none text-xs text-destructive">
                        отвяжется
                      </span>
                    )}
                    {willLink && (
                      <span className="flex-none text-xs text-faint">
                        добавится
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          <DialogFooter className="items-center">
            {diff && (
              <span className="me-auto text-sm text-muted-foreground tabular-nums">
                {diff}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isSaving || !changed}>
              {isSaving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default DeviceTypesDialog;
