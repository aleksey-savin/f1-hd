import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { isMobile } from "react-device-detect";
import { RiSaveLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import MobileActionBar from "@/components/app/MobileActionBar";
import { scrollToSection } from "@/components/app/AnchorRail";
import type { DraftSection } from "@/components/app/draft-context";
import { plural } from "@/util/plural";

// Плашка несохранённых правок на странице настроек: пока черновик пуст, её на
// экране нет, а вместе с ней нет и ни одной кнопки сохранения. Геометрия и
// анимация — как у app/BulkActionBar (остров у нижнего края на десктопе,
// app/MobileActionBar на телефоне), поэтому правило «на экране всегда ровно
// один плавающий объект» соблюдается само.
//
// Что несёт плашка: точку состояния и фразу с именами изменённых разделов
// (имя ведёт к секции), «Отмена» и «Сохранить». Заливка в панелях после этого
// не остаётся ни у чего — проверки и мгновенные действия перестают спорить с
// сохранением.

/** Сверх этого числа имена сворачиваются в «и ещё N» — плашка не растёт. */
const MAX_NAMES = 2;

const DraftBar = ({
  sections,
  isSaving = false,
  blockedReason = null,
  onSave,
  onReset,
}: {
  sections: DraftSection[];
  isSaving?: boolean;
  /** Непустая причина занимает строку статуса и гасит «Сохранить». */
  blockedReason?: string | null;
  onSave: () => void;
  onReset: () => void;
}) => {
  const reduceMotion = useReducedMotion();

  const show = sections.length > 0;
  const saveLabel = isSaving ? "Сохранение…" : "Сохранить";
  const named = sections.slice(0, MAX_NAMES);
  const rest = sections.length - named.length;

  if (isMobile) {
    // На 390 px разделы не перечислить — остров считает их.
    const count = sections.length;
    const word = plural(count, "раздел", "раздела", "разделов");

    return (
      <MobileActionBar
        show={show}
        statusText={`Не сохранено: ${count} ${word}`}
        actions={[
          {
            key: "save",
            icon: RiSaveLine,
            label: "Сохранить",
            reason: blockedReason,
          },
        ]}
        isLoading={isSaving}
        onPick={onSave}
        onCancel={onReset}
        cancelLabel="Отмена"
        ariaLabel="Несохранённые изменения"
      />
    );
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 34 }
          }
          // draft-bar (index.css) уводит плашку вправо вслед за контентом,
          // когда рейл статусов зарезервировал себе место: центр плашки —
          // центр КОНТЕНТНОЙ области, а не окна.
          className="draft-bar pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-12"
          // Легаси-шкала z: выше бара оболочки (1030) и radix-оверлеев
          style={{ zIndex: 1100 }}
        >
          <div
            role="toolbar"
            aria-label="Несохранённые изменения"
            className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg"
          >
            <span className="inline-flex items-center gap-2 pe-1 text-sm font-semibold">
              <span
                aria-hidden="true"
                className="size-1.5 flex-none rounded-full bg-warning"
              />
              {blockedReason ?? "Не сохранено:"}
            </span>

            {!blockedReason &&
              named.map((section, index) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(null, section.id)}
                  className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm font-semibold text-accent-text underline decoration-1 underline-offset-4 outline-none hover:text-primary focus-visible:rounded-sm focus-visible:ring-4 focus-visible:ring-ring/50"
                >
                  {index < named.length - 1 || rest > 0
                    ? `${section.label},`
                    : section.label}
                </button>
              ))}

            {!blockedReason && rest > 0 && (
              <span className="text-sm text-muted-foreground">
                и ещё {rest}
              </span>
            )}

            <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />

            <Button variant="ghost" onClick={onReset} disabled={isSaving}>
              Отмена
            </Button>
            <Button onClick={onSave} disabled={isSaving || !!blockedReason}>
              {saveLabel}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DraftBar;
