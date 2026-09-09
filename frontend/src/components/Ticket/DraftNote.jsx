import { formatDayMonthTime, formatTime } from "../../util/format-date";

// Строка «Черновик от …» в ряду с пилюлей заготовки: анкета возвращается
// заполненной, и это надо объяснить — форма, которая сама себя заполнила без
// единого слова, читается как сбой. Здесь же выход: «Очистить» убирает
// черновик и возвращает форму к исходному виду (значения заготовки или пусто).
//
// Возвращает не блок, а элементы ряда (фрагмент): ряд собирает шапка формы,
// где рядом стоит пилюля. Строка про вложения — второй элемент с `basis-full`,
// то есть переносится под ряд во всю ширину; она нужна редко и не должна
// растягивать сам ряд.
//
// Сегодняшний черновик называем временем, вчерашний — днём и временем: «от
// 14:32» у наброска трёхдневной давности сбивает.
const savedLabel = (savedAt) => {
  const saved = new Date(savedAt);
  const now = new Date();
  const sameDay =
    saved.getFullYear() === now.getFullYear() &&
    saved.getMonth() === now.getMonth() &&
    saved.getDate() === now.getDate();
  return sameDay ? formatTime(saved) : formatDayMonthTime(saved);
};

const DraftNote = ({ draft, onReset }) => {
  if (!draft) return null;

  return (
    <>
      <span className="text-sm text-muted-foreground">
        Черновик от {savedLabel(draft.savedAt)}
        <span aria-hidden className="mx-1.5 text-faint">
          ·
        </span>
        <button
          type="button"
          onClick={onReset}
          // appearance/border/bg/p-0 явно: preflight выключен
          className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm font-semibold text-accent-text outline-none hover:underline focus-visible:underline"
        >
          Очистить
        </button>
      </span>
      {/* Файл в строку не положить, поэтому вложения черновик не хранит.
          Молча пропавшее вложение читается как поломка — говорим прямо */}
      {draft.hadFiles && (
        <span className="basis-full text-sm text-faint">
          Вложения не сохранились — прикрепите заново
        </span>
      )}
    </>
  );
};

export default DraftNote;
