import { RiArrowRightSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import type { PipelineStageKey, StageStat } from "../../types/approval";
import { formatMoney } from "./work-format";

/**
 * Конвейер раздела «Согласование работ».
 *
 * Раздел отвечает на вопрос «где застряли деньги», поэтому вместо четырёх
 * сложенных друг на друга таблиц — ряд стадий, и он же фильтр списка под
 * собой. Паттерн «сводка = переключатель» уже канон приложения
 * (Report/MetricCards): один элемент делает две работы.
 *
 * Стадии НЕ раскрашены намеренно. Гайд разрешает говорить цветом максимум о
 * трёх вещах, здесь это выбранная плитка, срок и главное действие; пять
 * цветных плиток превратили бы рейл в светофор без смысла. Стадия читается
 * позицией и подписью — они фиксированы. Номеров «01/02/03» тоже нет:
 * последовательность реальная, но порядковый номер не сообщает ничего сверх
 * подписи, поэтому между плитками только волосяные шевроны.
 *
 * Названия стадий — те же, что были в фильтре прежнего экрана: раздел переехал
 * на новый стек, словарь пользователя не менялся.
 */

/** Русское склонение по числу — общее для рейла и списков конвейера. */
export const plural = (count: number, forms: [string, string, string]) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
};

export const STAGES: { key: PipelineStageKey; label: string }[] = [
  { key: "preview", label: "Превью" },
  { key: "pendingApproval", label: "На утверждении" },
  { key: "approved", label: "Сформировать счёт" },
  { key: "awaitingPayment", label: "Ждём оплаты" },
  { key: "paid", label: "Оплачен" },
];

const daysLabel = (days: number) =>
  `${days} ${plural(days, ["день", "дня", "дней"])}`;

/**
 * Строка часов у стадии — её живой вопрос, а не абстрактный возраст:
 * у подбора это работы, мешающие сформировать отчёт, у согласования — срок
 * автоподписи, дальше — сколько документ ждёт следующего действия.
 */
const clockOf = (
  key: PipelineStageKey,
  stat: StageStat,
): { text: string; tone: "muted" | "warning" | "destructive" } | null => {
  if (key === "preview") {
    if (!stat.unrelatedWorks) return null;
    return {
      text: `${stat.unrelatedWorks} ${plural(stat.unrelatedWorks, ["работа", "работы", "работ"])} вне услуг`,
      tone: "warning",
    };
  }

  if (key === "pendingApproval") {
    if (stat.nearestDeadlineDays == null) return null;
    if (stat.nearestDeadlineDays < 0) {
      return { text: "срок вышел", tone: "destructive" };
    }
    return {
      text:
        stat.nearestDeadlineDays === 0
          ? "автоподпись сегодня"
          : `автоподпись через ${daysLabel(stat.nearestDeadlineDays)}`,
      tone: stat.nearestDeadlineDays <= 1 ? "destructive" : "warning",
    };
  }

  if (key === "approved" && stat.oldestDays != null) {
    return {
      text: `без счёта ${daysLabel(stat.oldestDays)}`,
      tone: stat.oldestDays > 7 ? "warning" : "muted",
    };
  }

  if (key === "awaitingPayment" && stat.oldestInvoiceDays != null) {
    return {
      text: `счёту ${daysLabel(stat.oldestInvoiceDays)}`,
      tone: stat.oldestInvoiceDays > 30 ? "destructive" : "muted",
    };
  }

  if (key === "paid" && stat.count > 0) {
    return { text: `к архивации: ${stat.count}`, tone: "muted" };
  }

  return null;
};

// Строка подбора — это будущий отчёт (компания × услуга × месяц), поэтому
// счёт везде в отчётах: стадия меняется, единица измерения — нет
const countLabel = (stat: StageStat) =>
  `${stat.count} ${plural(stat.count, ["отчёт", "отчёта", "отчётов"])}`;

const PipelineRail = ({
  stages,
  active,
  onSelect,
}: {
  stages: Partial<Record<string, StageStat>>;
  active: string;
  onSelect: (stage: PipelineStageKey) => void;
}) => (
  <div
    role="tablist"
    aria-label="Стадии конвейера"
    // На узком экране плитки уходят в горизонтальную прокрутку со снапом:
    // сжимать деньги до нечитаемого нельзя
    className="tw:-mx-1 tw:flex tw:items-stretch tw:overflow-x-auto tw:px-1 tw:pb-1 tw:max-lg:snap-x"
  >
    {STAGES.map((stage, index) => {
      const stat = stages[stage.key] || { count: 0, total: 0 };
      const clock = clockOf(stage.key, stat);
      const isActive = active === stage.key;
      const isTerminal = stage.key === "paid";

      return (
        <div key={stage.key} className="tw:contents">
          {index > 0 && (
            <span
              aria-hidden
              className="tw:grid tw:w-5 tw:flex-none tw:place-items-center tw:self-center tw:text-faint"
            >
              <RiArrowRightSLine size={16} />
            </span>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(stage.key)}
            className={cn(
              "tw:flex tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:appearance-none tw:flex-col tw:gap-0.5 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-4 tw:text-left tw:outline-none tw:transition-colors tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:max-lg:min-w-56 tw:max-lg:flex-none tw:max-lg:snap-start",
              // Ширина у всех плиток равная — рейл читается как один ряд;
              // у терминальной просто нечего показывать под подписью
              isTerminal && "tw:justify-center",
              isActive && "tw:border-primary tw:ring-1 tw:ring-primary tw:ring-inset",
            )}
          >
            <span
              className={cn(
                "tw:flex tw:items-start tw:text-xs tw:font-bold tw:tracking-wider tw:uppercase",
                // Две строки под подпись резервируем только там, где под ней
                // ещё есть цифры
                !isTerminal && "tw:min-h-8",
                isActive ? "tw:text-accent-text" : "tw:text-muted-foreground",
              )}
            >
              {stage.label}
            </span>

            {/* «Оплачен» — по сути архив: деньги и счётчики здесь ни на что не
                влияют и никуда не ведут, поэтому плитка несёт только подпись */}
            {!isTerminal && (
              <>
                <span className="tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight tw:tabular-nums">
                  {formatMoney(stat.total)}
                </span>
                <span className="tw:text-sm tw:text-muted-foreground tw:tabular-nums">
                  {countLabel(stat)}
                </span>
                <span
                  className={cn(
                    "tw:mt-1 tw:text-xs tw:tabular-nums",
                    clock?.tone === "warning" && "tw:font-semibold tw:text-warning",
                    clock?.tone === "destructive" &&
                      "tw:font-semibold tw:text-destructive",
                    (!clock || clock.tone === "muted") && "tw:text-faint",
                  )}
                >
                  {/* Неразрывный пробел держит высоту плиток ровной */}
                  {clock?.text || "\u00a0"}
                </span>
              </>
            )}
          </button>
        </div>
      );
    })}
  </div>
);

export default PipelineRail;
