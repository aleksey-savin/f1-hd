import { type ReactNode } from "react";
import { Link } from "react-router";
import { RiInformationLine } from "react-icons/ri";

import { Eyebrow } from "@/components/app/Panel";
import { monogramFor } from "@/components/app/monogram";
import { Skeleton } from "@/components/ui/skeleton";

import type {
  CategoryRow,
  MonthPoint,
  ReportDiagnostics,
} from "../../types/report";

import ShareBars from "./ShareBars";
import WorkTimeBars from "./WorkTimeBars";

// Блоки, общие для карточки компании и карточки подразделения: монограмма
// заголовка, пояснение объёма доступа, разрез по категориям, помесячная
// динамика и сноска о неточностях атрибуции. Один вид одной информации на двух
// экранах — из каталога, а не копией по страницам.

export const CardMonogram = ({ name }: { name: string }) => (
  <span
    aria-hidden
    className="tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:bg-accent tw:text-base tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
  >
    {monogramFor(name)}
  </span>
);

export const CardCrumbs = ({
  items,
}: {
  items: { label: string; to?: string }[];
}) => (
  <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:text-sm tw:text-muted-foreground">
    {items.map((item, index) => (
      <span key={item.label} className="tw:inline-flex tw:items-center tw:gap-1.5">
        {index > 0 && <span className="tw:text-faint">/</span>}
        {item.to ? (
          <Link
            to={item.to}
            className="tw:text-muted-foreground tw:no-underline tw:hover:text-foreground tw:hover:underline"
          >
            {index === 0 ? `‹ ${item.label}` : item.label}
          </Link>
        ) : (
          <span className="tw:text-faint">{item.label}</span>
        )}
      </span>
    ))}
  </div>
);

/**
 * Объём доступа словами. Неполные данные без подписи читаются как потерянные,
 * поэтому у суженного доступа объяснение стоит выше цифр.
 */
export const ScopeNote = ({ children }: { children: ReactNode }) => (
  <div className="tw:mb-5 tw:flex tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-dashed tw:border-border tw:bg-card tw:px-4 tw:py-3">
    <RiInformationLine
      size={18}
      aria-hidden
      className="tw:mt-0.5 tw:flex-none tw:text-muted-foreground"
    />
    <div className="tw:text-sm tw:text-muted-foreground">{children}</div>
  </div>
);

export const CategorySection = ({ categories }: { categories: CategoryRow[] }) => (
  <div>
    <Eyebrow count={categories.length}>По категориям заявок</Eyebrow>
    <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
      <ShareBars
        unit="ms"
        rows={categories.map((category) => ({
          key: category._id ?? "none",
          label: category.title,
          value: category.time,
        }))}
      />
    </div>
  </div>
);

export const MonthsSection = ({ months }: { months: MonthPoint[] }) => {
  const withData = months.filter((month) => month.totalWorks > 0);
  const average = withData.length
    ? withData.reduce((sum, month) => sum + month.totalTime, 0) / withData.length
    : 0;
  const peak = withData.reduce<MonthPoint | null>(
    (best, month) => (!best || month.totalTime > best.totalTime ? month : best),
    null,
  );

  return (
    <>
      <Eyebrow
        action={
          peak && (
            <span className="tw:text-sm tw:font-normal tw:text-faint">
              в среднем {Math.round(average / 3_600_000)} ч · макс — {peak.label}
            </span>
          )
        }
      >
        Динамика за 12 месяцев
      </Eyebrow>
      <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
        <WorkTimeBars
          bars={months.map((month) => ({
            key: month.month,
            // «июль 2026» → «июль»: год виден из оси целиком
            label: month.label.replace(/\s\d{4}$/, ""),
            minutes: Math.round(month.totalTime / 60_000),
            overtimeMinutes: 0,
          }))}
          height={190}
        />
      </div>
    </>
  );
};

/**
 * Сноска о работах, чья привязка к подразделению неоднозначна. Молчать нельзя:
 * иначе расхождение сумм выглядит потерей данных.
 */
export const AttributionNote = ({
  diagnostics,
}: {
  diagnostics: ReportDiagnostics;
}) => {
  if (diagnostics.mixedSubdivisionWorks === 0) {
    return null;
  }
  return (
    <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-faint">
      Работа отнесена к подразделению заявителя. {diagnostics.mixedSubdivisionWorks}{" "}
      {diagnostics.mixedSubdivisionWorks === 1 ? "работа" : "работ"} за период
      закрывали заявки разных подразделений — учтены по самой ранней заявке.
    </p>
  );
};

export const CardSkeleton = () => (
  <div className="tw:space-y-6">
    <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:grid-cols-4 tw:xl:gap-4">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="tw:h-28 tw:rounded-xl" />
      ))}
    </div>
    <Skeleton className="tw:h-64 tw:rounded-xl" />
    <Skeleton className="tw:h-72 tw:rounded-xl" />
  </div>
);
