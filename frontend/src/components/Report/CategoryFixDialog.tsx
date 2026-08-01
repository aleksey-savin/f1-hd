import { useEffect, useState } from "react";

import Combobox, { toOptions } from "@/components/app/Combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { getLocalStorageData } from "../../util/auth";

/**
 * Правка категории заявки у работ, не попавших ни под одну услугу.
 *
 * Работ может быть несколько — диалог ведёт по ним ПОШАГОВО: сохранил
 * категорию, тут же подставилась следующая заявка. Так очередь разбирается
 * одним заходом, без возврата к списку за каждой строкой.
 *
 * В карточке заявки показываем тему, обращение и текущую категорию: описание
 * работы говорит, ЧТО сделали, а категорию выбирают по тому, О ЧЁМ было
 * обращение.
 */

const API = import.meta.env.VITE_API_ADDRESS;

const fullName = (person?: { firstName?: string; lastName?: string }) =>
  person ? `${person.lastName || ""} ${person.firstName || ""}`.trim() : "—";

const CategoryFixDialog = ({
  works,
  open,
  onOpenChange,
  onFixed,
}: {
  works: any[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вызывается после каждой успешной правки — данные под диалогом устаревают. */
  onFixed: () => void;
}) => {
  const [index, setIndex] = useState(0);
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setCategory(null);
    setError(null);

    const { token } = getLocalStorageData();
    fetch(`${API}/api/ticket-categories`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => response.json())
      .then((list) => setCategories(list || []))
      .catch(() => setCategories([]));
  }, [open]);

  const work = works[index];
  const ticket = work?.tickets?.[0];

  const save = async () => {
    if (!category || !ticket) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(`${API}/api/tickets/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ _id: ticket._id, categoryId: category._id }),
      });
      if (!response.ok) throw new Error("Не удалось сменить категорию заявки");

      onFixed();
      setCategory(null);
      // Следующая заявка из очереди; закончились — закрываемся
      if (index + 1 < works.length) {
        setIndex(index + 1);
      } else {
        onOpenChange(false);
      }
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!work) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Категория заявки {ticket?.num}
            {works.length > 1 && (
              <span className="ms-2 text-sm font-normal text-muted-foreground tabular-nums">
                {index + 1} из {works.length}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Выберите категорию, привязанную к нужной услуге, — работа сразу
            попадёт в расчёт.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-accent px-3.5 py-2.5 text-sm">
          <div className="font-semibold">{ticket?.title || "Без темы"}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>Заявитель: {fullName(ticket?.applicantId)}</span>
            <span>
              Текущая категория:{" "}
              <b className="font-semibold text-warning">
                {ticket?.categoryId?.title || "не указана"}
              </b>
            </span>
          </div>

          {ticket?.description && (
            <div className="mt-2 border-t border-border-soft pt-2">
              <div className="text-xs font-semibold tracking-wide text-faint uppercase">
                Обращение
              </div>
              {/* Описание бывает длинным — ограничиваем высоту, чтобы диалог
                    не разъезжался на весь экран */}
              <div className="mt-1 max-h-32 overflow-y-auto break-words whitespace-pre-line">
                {ticket.description}
              </div>
            </div>
          )}

          {work.description && (
            <div className="mt-2 border-t border-border-soft pt-2">
              <div className="text-xs font-semibold tracking-wide text-faint uppercase">
                Что сделали
              </div>
              <div className="mt-1 break-words">{work.description}</div>
            </div>
          )}
        </div>

        <Combobox
          id="unrelated-category"
          placeholder="Новая категория"
          options={toOptions(categories as any[], {
            value: (item) => String(item._id),
            label: (item) => item.title,
          })}
          value={category?._id ? String(category._id) : null}
          onChange={(id) =>
            setCategory(
              (categories as any[]).find((item) => String(item._id) === id) ??
                null,
            )
          }
        />

        {error && <div className="text-sm text-destructive">{error}</div>}

        <DialogFooter>
          {works.length > 1 && index + 1 < works.length && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setCategory(null);
                setIndex(index + 1);
              }}
              className="me-auto"
            >
              Пропустить
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
          <Button disabled={busy || !category} onClick={save}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CategoryFixDialog;
