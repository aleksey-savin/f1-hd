import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useActionData, useFetcher } from "react-router";

import {
  RiAddFill,
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiDraggable,
  RiEdit2Line,
  RiMoreLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Field from "@/components/app/Field";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { FormActions, FormHeader } from "@/components/app/FormLayout";
import { useFormSheet } from "@/components/app/FormOutlet";
import { cn } from "@/lib/utils";
import {
  dropLineClass,
  moveItem,
  useDragReorder,
  useFlipRows,
} from "@/hooks/use-drag-reorder";

import { plural } from "../../util/plural";
import useToastStore from "../../store/toast-store";

const isUsed = (group) =>
  (group.typesCount || 0) > 0 || (group.attributesCount || 0) > 0;

// «N типов · M атр.» — где группа используется; иначе «не используется»
const usageLabel = (group) => {
  if (!isUsed(group)) return "не используется";
  const types = group.typesCount || 0;
  return `${types} ${plural(types, "тип", "типа", "типов")} · ${group.attributesCount || 0} атр.`;
};

// «⋯» группы: Переименовать (диалог имени) · Выше/Ниже (порядок на тач и с
// клавиатуры) · Удалить. Удалить можно только неиспользуемую — у используемой
// пункт выключен, под ним причина. Диалог удаления — ВНЕ radix-меню (меню
// размонтирует содержимое при закрытии), открывается состоянием; ср.
// AttrActions на карточке типа.
const GroupActions = ({ group, index, count, onRename, onMove }) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const used = isUsed(group);
  const reasonId = useId();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Действия"
            title="Действия"
            // -my-2: попадание 36px, а строка остаётся 40px, как в макете
            className="-my-2 flex-none text-faint"
          >
            <RiMoreLine />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onRename(group)}>
            <RiEdit2Line /> Переименовать
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() => onMove(index, -1)}
          >
            <RiArrowUpLine /> Выше
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === count - 1}
            onSelect={() => onMove(index, 1)}
          >
            <RiArrowDownLine /> Ниже
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={used}
            aria-describedby={used ? reasonId : undefined}
            onSelect={() => setDeleteOpen(true)}
          >
            <RiDeleteBinLine /> Удалить
          </DropdownMenuItem>
          {used && (
            // Отступ слева — под текст пункта (px-2 + иконка 16 + gap-2)
            <div
              id={reasonId}
              className="pr-2 pb-1.5 pl-8 text-xs text-muted-foreground"
            >
              Группа используется
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteDialog
        item={{ _id: group._id, title: group.name }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
};

// Диалог имени группы — один на «Новая группа» и «Переименовать». Сабмит —
// fetcher на action маршрута (intent create/rename); успех закрывает диалог,
// ошибка (дубль имени — 409, пустое — 400) приходит тостом, диалог остаётся.
const GroupNameDialog = ({ open, onOpenChange, group }) => {
  const fetcher = useFetcher();
  const { showToast } = useToastStore();
  const submitted = useRef(false);
  const isRename = Boolean(group);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (!submitted.current || fetcher.state !== "idle" || !fetcher.data) {
      return;
    }
    submitted.current = false;
    if (fetcher.data.error) showToast("danger", fetcher.data.message);
    else onOpenChange(false);
  }, [fetcher.state, fetcher.data, onOpenChange, showToast]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    submitted.current = true;
    fetcher.submit(
      isRename
        ? { intent: "rename", id: group._id, name }
        : { intent: "create", name },
      { method: "post" },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {isRename ? "Переименовать группу" : "Новая группа"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Field label="Название" htmlFor="attribute-group-name" required>
            <Input
              id="attribute-group-name"
              name="name"
              required
              maxLength={80}
              autoFocus
              autoComplete="off"
              defaultValue={group?.name || ""}
            />
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

// Шторка «Группы атрибутов» (макет, раздел 6): строки с перетаскиванием,
// именем, «N типов · M атр.» и «⋯»; «Новая группа»; подвал «Закрыть». Порядок
// групп общий для всех карточек типов и сохраняется сразу после броска.
const GroupsSheet = ({ groups = [] }) => {
  const { close } = useFormSheet();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const reorderFetcher = useFetcher();

  // Диалог имени: open отдельно от группы — пока диалог уезжает, заголовок
  // не должен перескакивать с «Переименовать» на «Новая группа»
  const [nameOpen, setNameOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const openCreate = () => {
    setRenaming(null);
    setNameOpen(true);
  };
  const openRename = (group) => {
    setRenaming(group);
    setNameOpen(true);
  };

  // Удаление — DeleteDialog (RouterForm на action этого маршрута)
  useEffect(() => {
    if (actionData?.intent !== "delete") return;
    if (actionData.error) showToast("danger", actionData.message);
    else showToast("success", "Группа удалена");
  }, [actionData, showToast]);

  useEffect(() => {
    if (reorderFetcher.data?.error) {
      showToast("danger", reorderFetcher.data.message);
    }
  }, [reorderFetcher.data, showToast]);

  // Локальная (оптимистичная) последовательность: порядок меняем сразу,
  // сервер догоняет ревалидацией лоадера — тогда пересобираем из свежих данных
  const ordered = useMemo(() => [...groups], [groups]);
  const [items, setItems] = useState(ordered);
  useEffect(() => setItems(ordered), [ordered]);

  const submitOrder = (next) => {
    setItems(next);
    reorderFetcher.submit(
      {
        intent: "reorder",
        orderedIds: JSON.stringify(next.map((group) => group._id)),
      },
      { method: "post" },
    );
  };

  // «Выше/Ниже» из «⋯» — тач и клавиатура, где перетаскивания нет
  const onMove = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    submitOrder(moveItem(items, index, target));
  };

  // Перетаскивание (десктоп): порядок применяется на сбросе, плавность даёт
  // FLIP (как атрибуты на карточке типа). Корзина одна — весь список.
  const drag = useDragReorder({
    onMove: (_bucket, from, to) => submitOrder(moveItem(items, from, to)),
  });
  const rowRef = useFlipRows(items);

  return (
    <>
      <FormHeader
        title="Группы атрибутов"
        subtitle="Порядок групп — общий для всех типов"
      />

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Групп пока нет
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {items.map((group, index) => {
            const used = isUsed(group);
            return (
              <div
                key={group._id}
                ref={rowRef(group._id)}
                {...drag.rowProps("groups", index, group._id)}
                className={cn(
                  "relative flex items-center gap-3 bg-card px-4 py-2.5",
                  index > 0 && "border-t border-border-soft",
                  drag.draggingId === group._id && "opacity-50",
                  // индикатор места вставки — акцентная линия там, куда
                  // строка ляжет
                  dropLineClass(drag.indicator(group._id)),
                )}
              >
                <RiDraggable
                  aria-hidden
                  className="size-4 flex-none cursor-grab text-faint"
                />
                <span className="min-w-0 flex-1 text-sm font-medium break-words">
                  {group.name}
                </span>
                <span
                  className={cn(
                    "flex-none text-sm tabular-nums",
                    used ? "text-muted-foreground" : "text-faint",
                  )}
                >
                  {usageLabel(group)}
                </span>
                <GroupActions
                  group={group}
                  index={index}
                  count={items.length}
                  onRename={openRename}
                  onMove={onMove}
                />
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={openCreate}
      >
        <RiAddFill /> Новая группа
      </Button>

      <FormActions className="mt-3 justify-end">
        <Button type="button" variant="ghost" onClick={() => close()}>
          Закрыть
        </Button>
      </FormActions>

      <GroupNameDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        group={renaming}
      />
    </>
  );
};

export default GroupsSheet;
