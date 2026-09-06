import { type ReactNode } from "react";
import { RiInformationLine } from "react-icons/ri";

import { Eyebrow } from "@/components/app/Panel";
import { Skeleton } from "@/components/ui/skeleton";

import type {
  CategoryRow,
  CompanyRef,
  MonthPoint,
  ReportDiagnostics,
} from "../../types/report";

import CompanyLogo from "../Company/CompanyLogo";
import ShareBars from "./ShareBars";
import WorkTimeBars from "./WorkTimeBars";

// Блоки, общие для карточки компании и карточки подразделения: плитка
// заголовка, пояснение объёма доступа, разрез по категориям, помесячная
// динамика и сноска о неточностях атрибуции. Один вид одной информации на двух
// экранах — из каталога, а не копией по страницам.

/** Плитка hero — логотип компании (у филиала — его компании), без логотипа
 *  тихий глиф раздела; та же плитка, что в строке списка компаний. */
export const CardTile = ({ company }: { company?: CompanyRef | null }) => (
  <CompanyLogo
    company={company}
    sizeClass="size-14"
    glyphSize={26}
    className="rounded-2xl"
  />
);

/**
 * Объём доступа словами. Неполные данные без подписи читаются как потерянные,
 * поэтому у суженного доступа объяснение стоит выше цифр.
 */
export const ScopeNote = ({ children }: { children: ReactNode }) => (
  <div className="mb-5 flex items-start gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3">
    <RiInformationLine
      size={18}
      aria-hidden
      className="mt-0.5 flex-none text-muted-foreground"
    />
    <div className="text-sm text-muted-foreground">{children}</div>
  </div>
);

export const CategorySection = ({
  categories,
}: {
  categories: CategoryRow[];
}) => (
  <div>
    <Eyebrow count={categories.length}>По категориям заявок</Eyebrow>
    <div className="rounded-xl border border-border bg-card p-5">
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
    ? withData.reduce((sum, month) => sum + month.totalTime, 0) /
      withData.length
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
            <span className="text-sm font-normal text-faint">
              в среднем {Math.round(average / 3_600_000)} ч · макс —{" "}
              {peak.label}
            </span>
          )
        }
      >
        Динамика за 12 месяцев
      </Eyebrow>
      <div className="rounded-xl border border-border bg-card p-5">
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
    <p className="mt-3 mb-0 text-xs text-faint">
      Работа отнесена к подразделению заявителя.{" "}
      {diagnostics.mixedSubdivisionWorks}{" "}
      {diagnostics.mixedSubdivisionWorks === 1 ? "работа" : "работ"} за период
      закрывали заявки разных подразделений — учтены по самой ранней заявке.
    </p>
  );
};

export const CardSkeleton = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-28 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-64 rounded-xl" />
    <Skeleton className="h-72 rounded-xl" />
  </div>
);
