import { useEffect, useState } from "react";

import Select from "@/UI/Select";
import { InsideOverlayContext } from "@/components/app/overlay-context";
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
        {/* UI/Select внутри модального оверлея работает инлайн-меню */}
        <InsideOverlayContext.Provider value={true}>
          <DialogHeader>
            <DialogTitle>
              Категория заявки {ticket?.num}
              {works.length > 1 && (
                <span className="tw:ms-2 tw:text-sm tw:font-normal tw:text-muted-foreground tw:tabular-nums">
                  {index + 1} из {works.length}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Выберите категорию, привязанную к нужной услуге, — работа сразу
              попадёт в расчёт.
            </DialogDescription>
          </DialogHeader>

          <div className="tw:rounded-lg tw:border tw:border-border tw:bg-accent tw:px-3.5 tw:py-2.5 tw:text-sm">
            <div className="tw:font-semibold">{ticket?.title || "Без темы"}</div>
            <div className="tw:mt-1 tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-0.5 tw:text-muted-foreground">
              <span>Заявитель: {fullName(ticket?.applicantId)}</span>
              <span>
                Текущая категория:{" "}
                <b className="tw:font-semibold tw:text-warning">
                  {ticket?.categoryId?.title || "не указана"}
                </b>
              </span>
            </div>

            {ticket?.description && (
              <div className="tw:mt-2 tw:border-t tw:border-border-soft tw:pt-2">
                <div className="tw:text-xs tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
                  Обращение
                </div>
                {/* Описание бывает длинным — ограничиваем высоту, чтобы диалог
                    не разъезжался на весь экран */}
                <div className="tw:mt-1 tw:max-h-32 tw:overflow-y-auto tw:break-words tw:whitespace-pre-line">
                  {ticket.description}
                </div>
              </div>
            )}

            {work.description && (
              <div className="tw:mt-2 tw:border-t tw:border-border-soft tw:pt-2">
                <div className="tw:text-xs tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
                  Что сделали
                </div>
                <div className="tw:mt-1 tw:break-words">{work.description}</div>
              </div>
            )}
          </div>

          <Select
            id="unrelated-category"
            placeholder="Новая категория"
            options={categories.map((item: any) => ({
              _id: item._id,
              title: item.title,
            }))}
            getOptionLabel={(option: any) => option.title}
            getOptionValue={(option: any) => option._id}
            value={category}
            onChange={setCategory}
          />

          {error && <div className="tw:text-sm tw:text-destructive">{error}</div>}

          <DialogFooter>
            {works.length > 1 && index + 1 < works.length && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCategory(null);
                  setIndex(index + 1);
                }}
                className="tw:me-auto"
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
        </InsideOverlayContext.Provider>
      </DialogContent>
    </Dialog>
  );
};

export default CategoryFixDialog;
