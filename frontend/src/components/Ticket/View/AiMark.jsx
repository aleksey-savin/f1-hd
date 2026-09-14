import { useState } from "react";

import { RiSparkling2Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import useToastStore from "../../../store/toast-store";
import useInitialPrefsStore from "../../../store/prefs";
import { useCan } from "@/store/authed-user";

// Метка того, что ИИ вписал в заявку вместо человека, — и вход в замечание.
//
// Правило, где метка стоит: только у ПОЛЕЙ заявки, заполненных моделью, —
// описания, собранного из записи звонка, и подобранной категории. Ошибка в них
// тихо уезжает дальше: в уведомление, в отчёт, в подбор заметок. Руководство и
// справку метить незачем — они стоят рядом с данными, а не вместо них, и
// правятся иначе. Правило записано в docs/ux-ui-guide.md, раздел «Что сделал
// ИИ, а что человек».
//
// Метка — одна иконка без подписи: она сообщает происхождение поля, а не
// требует действия, и подписанный бейдж на плотной карточке перетягивал
// внимание с самого текста. Смысл несёт подсказка по наведению.
//
// Иконка — общая для всего приложения RiSparkling2Line, ровно та же, что в
// строке понятий и в «Руководстве ИИ». У описания метка живёт внутри готового
// html, куда React-узел не попадёт, поэтому там та же иконка собрана как svg
// (View/TicketTerms.appendAiMark); оформление обеих — класс .ai-mark.
//
// Замечание открывается диалогом, а не блоком на месте: раздвигать описание,
// которое человек в этот момент читает, — худшее, что можно сделать с его
// вниманием. Это диалог действия, поэтому сабмит называется самим действием
// («Записать замечание»), а не «Сохранить».
const REASONS = [
  { value: "offtopic", label: "Не по делу" },
  { value: "facts", label: "Ошибка в фактах" },
  { value: "invented", label: "Выдумано" },
  { value: "outdated", label: "Устарело" },
];

const AiMark = ({
  ticketId,
  target,
  hint,
  title,
  scope,
  className,
  // Управляемый режим: у описания метка живёт в html, а не React-узлом — своей
  // кнопки компонент тогда не рисует, а состояние держит вызывающая секция
  open: openProp,
  onOpenChange,
}) => {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (value) =>
    controlled ? onOpenChange(value) : setOpenState(value);

  const [reason, setReason] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const showToast = useToastStore((state) => state.showToast);
  const can = useCan();
  // Замечания — отдельная функция ИИ (Настройки → ИИ → «Функции») и право
  // исполнителя; без них метка остаётся фактом происхождения поля
  const feedbackOn = useInitialPrefsStore(
    (state) => !!state.ai?.features?.feedback,
  );
  const canFeedback = feedbackOn && !!can({ ticket: ["perform"] });

  const close = () => {
    setOpen(false);
    setReason(null);
    setText("");
  };

  const submit = async () => {
    setBusy(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-feedback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ _id: ticketId, target, reason, text }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message);

      showToast("success", data.message);
      close();
    } catch (error) {
      showToast(
        "danger",
        error.message || "Не удалось записать замечание — попробуйте ещё раз",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canFeedback) {
    // Управляемую метку рисует html описания — без замечаний ей нечего открыть
    if (controlled) return null;
    return (
      <span
        role="img"
        title={hint}
        aria-label={hint}
        className={cn("ai-mark is-static", className)}
      >
        <RiSparkling2Line size={14} aria-hidden />
      </span>
    );
  }

  return (
    <>
      {!controlled && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`${hint} — нажмите, если что-то не так`}
          aria-label={`${hint} — сообщить об ошибке`}
          className={cn(
            "ai-mark appearance-none border-0 bg-transparent p-0 outline-none",
            className,
          )}
        >
          <RiSparkling2Line size={14} aria-hidden />
        </button>
      )}

      <Dialog
        open={open}
        onOpenChange={(value) => (value ? setOpen(true) : close())}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <p className="my-0 text-sm text-muted-foreground">{hint}</p>

          {/* Причина обязательна: из «не понравилось» правила не составить */}
          <div className="flex flex-wrap gap-2">
            {REASONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setReason(item.value)}
                className={cn(
                  "cursor-pointer appearance-none rounded-full border px-2.5 py-0.5 text-xs outline-none",
                  reason === item.value
                    ? "border-primary/40 bg-primary/8 text-accent-text"
                    : "border-transparent bg-accent text-foreground hover:border-primary/30",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Что неверно и как правильно"
            rows={4}
            className="text-sm"
          />

          <p className="my-0 text-xs text-muted-foreground">
            Замечание попадёт в хронику заявки и в правила ИИ для {scope} — их
            видит вся команда, а включает администратор.
          </p>

          <DialogFooter>
            <Button
              size="sm"
              disabled={busy || !reason || !text.trim()}
              onClick={submit}
            >
              {busy ? "Записываем…" : "Записать замечание"}
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              Отмена
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AiMark;
