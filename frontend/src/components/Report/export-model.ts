import { formatMoneyExact } from "../../util/money.js";
import { plural } from "../../util/plural.js";
import { hhmm, rubles } from "./export-format.js";

/**
 * Что попадает в выгрузку отчёта по услуге — одна модель на PDF и Excel.
 *
 * Выгрузок две: полный отчёт и «только работы сверх тарифа» (его отправляют,
 * когда согласовать надо одну доплату). Обе собираются здесь из карточки
 * отчёта, а `ReportExportMenu` только рисует модель в файл: так PDF и Excel не
 * могут разойтись ни составом, ни цифрами.
 *
 * Правила те же, что на карточке: суммы — целыми рублями, ставки и цены
 * услуги — как заданы, с копейками; время — в поясе организации. Чего сервер
 * зрителю не отдал (итог договора — руководителю филиала), того нет и в файле.
 *
 * Модуль чистый: даты форматирует вызывающий.
 */

export type ExportVariant = "full" | "extra";

export type ExportFormatters = {
  shortDate: (value: string | Date) => string | null;
  /** «Владивосток (UTC+10)». */
  zoneLabel: string;
};

export type ExportRow = {
  startedAt: string;
  tickets: string;
  description: string;
  initiator: string;
  subdivision: string;
  executor: string;
  minutes: number;
  cost: number | null;
};

export type ExportTable = {
  title: string;
  hint: string;
  /** Имя листа в Excel. */
  sheet: string;
  withCost: boolean;
  rows: ExportRow[];
  totalLabel: string;
  totalMinutes: number;
  totalCost: number | null;
};

export type ExportModel = {
  variant: ExportVariant;
  kicker: string;
  title: string;
  /** Название услуги отдельно от периода — строкой реквизитов в Excel. */
  service: string;
  facts: { label: string; value: string }[];
  tiles: { label: string; value: string; strong?: boolean }[];
  /** Условия расчёта одной строкой: «текст значение · текст значение». */
  terms: { text: string; value?: string }[];
  tables: ExportTable[];
  note: string | null;
  footer: string;
  /** Строки итога для листа «Сводка» — числами, чтобы Excel мог считать. */
  summary: {
    label: string;
    count: number;
    minutes: number;
    amount: number | null;
    strong?: boolean;
  }[];
};

const TARIFF_TEXT: Record<string, string> = {
  hourPackage: "пакеты часов",
  hourly: "почасовая оплата",
  fixedPrice: "фиксированная оплата",
};

const fullName = (person?: { firstName?: string; lastName?: string } | null) =>
  person ? `${person.lastName || ""} ${person.firstName || ""}`.trim() : "";

const worksLabel = (count: number) =>
  `${count} ${plural(count, "работа", "работы", "работ")}`;

const rowOf = (work: any, withCost: boolean): ExportRow => ({
  startedAt: work.startedAt,
  tickets: (work.tickets || []).map((ticket: any) => ticket.num).join(", "),
  description: work.description || "",
  initiator: [
    ...new Set(
      (work.tickets || [])
        .map((ticket: any) => fullName(ticket.applicantId))
        .filter(Boolean),
    ),
  ].join(", "),
  subdivision: work.subdivision?.name || "",
  executor: fullName(work.finishedBy),
  minutes: work.billedMinutes || 0,
  cost: withCost ? work.cost || 0 : null,
});

const tableOf = (
  works: any[],
  spec: Pick<ExportTable, "title" | "hint" | "sheet" | "withCost"> & {
    total: string;
  },
): ExportTable => {
  const rows = works.map((work) => rowOf(work, spec.withCost));
  return {
    title: spec.title,
    hint: spec.hint,
    sheet: spec.sheet,
    withCost: spec.withCost,
    rows,
    totalLabel: `${spec.total} · ${worksLabel(rows.length)}`,
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
    totalCost: spec.withCost
      ? rows.reduce((sum, row) => sum + (row.cost || 0), 0)
      : null,
  };
};

/**
 * Можно ли выгрузить «только работы сверх тарифа».
 * `none` — у услуги такого деления нет (почасовая оплата), пункта в меню нет
 * вовсе; `empty` — деление есть, но в этом отчёте таких работ не оказалось.
 */
export const extraAvailability = (report: any): "ok" | "empty" | "none" => {
  if (report.terms?.type === "hourly") return "none";
  return (report.overtimeWorks || []).length > 0 ? "ok" : "empty";
};

/** Что с согласованием — словами: в файле нет ни статуса, ни маршрута подписей. */
const approvalFact = (report: any, fmt: ExportFormatters) => {
  if (report.status === "preview") return "Отчёт ещё не сформирован";
  if (!report.approval?.required) return "Не требуется";
  if (report.status === "pendingApproval") {
    const deadline = report.approval.deadlineAt;
    return deadline
      ? `На согласовании · ответ до ${fmt.shortDate(deadline)}`
      : "На согласовании";
  }
  if (report.status === "declined") return "Отклонён клиентом";
  if (report.approval.autoApprovedAt) {
    return `Согласован по сроку ${fmt.shortDate(report.approval.autoApprovedAt)}`;
  }
  // Финальная подпись клиента; подписи отдельных частей — ещё не согласование
  const signed = [...(report.timeline || [])]
    .reverse()
    .find(
      (event: any) =>
        event.action === "approved" &&
        event.actor === "customer" &&
        event.scope !== "subdivision",
    );
  const who = fullName(signed?.by);
  return `Согласован${signed?.at ? ` ${fmt.shortDate(signed.at)}` : ""}${who ? ` · ${who}` : ""}`;
};

const tariffTerm = (terms: any): { text: string; value?: string } => {
  const text = TARIFF_TEXT[terms.type] || "оплата";
  if (terms.type === "fixedPrice" && terms.fixedPrice != null) {
    return { text, value: formatMoneyExact(terms.fixedPrice) };
  }
  if (terms.type === "hourly" && terms.pricePerHour != null) {
    return { text, value: `${formatMoneyExact(terms.pricePerHour)} / час` };
  }
  if (terms.type === "hourPackage" && terms.packageBasis) {
    const { hours, pricePerHour, mode } = terms.packageBasis;
    return {
      text: "пакет",
      value:
        mode === "overflow"
          ? `${hours} ч + сверх по ${formatMoneyExact(pricePerHour)} / час`
          : `${hours} ч · ${formatMoneyExact(hours * pricePerHour)}`,
    };
  }
  // Ограниченному зрителю цены не приходят — остаётся только название
  return { text };
};

/**
 * Пояснение к отчёту, сформированному до заморозки расчёта: итог у него —
 * сохранённый при формировании, а условия и разбивка по работам восстановлены
 * позже и могут с итогом не сходиться. Тот же текст — на карточке.
 */
export const legacyCalcNote = (
  report: { legacyCalc?: boolean; frozenAt?: string | null },
  shortDate: (value: string) => string | null,
) =>
  report.legacyCalc
    ? `Итог сохранён при формировании отчёта. Условия расчёта и разбивка по работам восстановлены${
        report.frozenAt ? ` ${shortDate(report.frozenAt)}` : ""
      } и могут с ним расходиться.`
    : null;

export const buildExportModel = (
  report: any,
  variant: ExportVariant,
  fmt: ExportFormatters,
): ExportModel => {
  const terms = report.terms || {};
  const calc = report.calc || {};
  const isHourly = terms.type === "hourly";
  const period = report.period || "";
  const legacyNote = legacyCalcNote(report, fmt.shortDate);
  const rate = terms.pricePerHourNonWorking;
  const rateLabel = rate ? `${formatMoneyExact(rate)} / час` : null;

  const overtime = tableOf(report.overtimeWorks || [], {
    title: "Работы в нерабочее время",
    hint: "оплачиваются сверх тарифа",
    sheet: "Сверх тарифа",
    withCost: true,
    total: "Итого сверх тарифа",
  });
  // У почасовой оплаты деления на рабочее и нерабочее время нет — таблица одна
  const worktime = tableOf(
    report.worktimeWorks || [],
    isHourly
      ? {
          title: "Работы",
          hint: "",
          sheet: "Работы",
          withCost: false,
          total: "Итого",
        }
      : {
          title: "Работы в рабочее время",
          hint:
            terms.type === "hourPackage"
              ? "входят в пакет часов"
              : "входят в тариф",
          sheet: "В тарифе",
          withCost: false,
          total: "Итого в тарифе",
        },
  );
  const hasOvertime = overtime.rows.length > 0;

  const facts = [
    {
      label: "Заказчик",
      value: report.company?.fullTitle || report.company?.alias || "",
    },
    ...(report.contractor?.alias
      ? [{ label: "Исполнитель", value: report.contractor.alias }]
      : []),
    { label: "Период", value: period },
    { label: "Согласование", value: approvalFact(report, fmt) },
  ];

  const footerBase = [report.company?.alias, report.servicePlan?.title, period]
    .filter(Boolean)
    .join(" · ");
  const periodTerm = terms.tariffingPeriod
    ? [{ text: "период тарификации", value: `${terms.tariffingPeriod} минут` }]
    : [];
  const zoneTerm = { text: "время в отчёте —", value: fmt.zoneLabel };
  const title = [report.servicePlan?.title, period].filter(Boolean).join(" · ");

  if (variant === "extra") {
    return {
      variant,
      kicker: "Отчёт о работах сверх тарифа",
      title,
      service: report.servicePlan?.title || "",
      facts,
      tiles: [
        { label: "Работ сверх тарифа", value: String(overtime.rows.length) },
        { label: "Время", value: hhmm(overtime.totalMinutes) },
        ...(rateLabel
          ? [{ label: "Ставка в нерабочее время", value: rateLabel }]
          : []),
        {
          label: "К оплате сверх тарифа",
          value: rubles(calc.additionalPrice ?? overtime.totalCost ?? 0),
          strong: true,
        },
      ],
      terms: [
        {
          text: "Сверх тарифа оплачиваются работы вне графика обслуживания",
        },
        ...periodTerm,
        zoneTerm,
      ],
      tables: [overtime],
      note:
        [
          worktime.rows.length > 0
            ? `Работы в рабочее время (${worksLabel(worktime.rows.length)}, ${hhmm(worktime.totalMinutes)}) входят в тариф и в этот отчёт не включены.`
            : null,
          legacyNote,
        ]
          .filter(Boolean)
          .join(" ") || null,
      footer: `${footerBase} · работы сверх тарифа`,
      summary: [
        {
          label: "К оплате сверх тарифа",
          count: overtime.rows.length,
          minutes: overtime.totalMinutes,
          amount: calc.additionalPrice ?? overtime.totalCost,
          strong: true,
        },
      ],
    };
  }

  const workingMinutes = calc.workingTimeMinutes ?? worktime.totalMinutes;
  const overtimeMinutes = calc.overtimeMinutes ?? overtime.totalMinutes;
  const worksCount =
    report.worksCount ?? worktime.rows.length + overtime.rows.length;
  // Деление «в тарифе / сверх тарифа» показываем, только когда оно есть
  const split = !isHourly && hasOvertime;

  const tiles: ExportModel["tiles"] = [
    { label: "Работ", value: String(worksCount) },
    {
      label: split ? "В рабочее время" : "Время",
      value: hhmm(workingMinutes),
    },
  ];
  if (split) {
    tiles.push({ label: "В нерабочее время", value: hhmm(overtimeMinutes) });
  }
  if (!isHourly && calc.price != null) {
    tiles.push({ label: "В тарифе", value: rubles(calc.price) });
  }
  if (split && calc.additionalPrice != null) {
    tiles.push({ label: "Сверх тарифа", value: rubles(calc.additionalPrice) });
  }
  if (calc.total != null) {
    tiles.push({
      label: "Итого к оплате",
      value: rubles(calc.total),
      strong: true,
    });
  }

  const summary: ExportModel["summary"] = isHourly
    ? []
    : [
        {
          label: "В рабочее время (в тарифе)",
          count: worktime.rows.length,
          minutes: workingMinutes,
          amount: calc.price ?? null,
        },
        ...(hasOvertime
          ? [
              {
                label: "В нерабочее время (сверх тарифа)",
                count: overtime.rows.length,
                minutes: overtimeMinutes,
                amount: calc.additionalPrice ?? null,
              },
            ]
          : []),
      ];
  summary.push({
    label: "Итого к оплате",
    count: worksCount,
    minutes: workingMinutes + (isHourly ? 0 : overtimeMinutes),
    amount: calc.total ?? null,
    strong: true,
  });

  return {
    variant,
    kicker: "Отчёт об оказанных услугах",
    title,
    service: report.servicePlan?.title || "",
    facts,
    tiles,
    terms: [
      tariffTerm(terms),
      ...periodTerm,
      ...(rateLabel ? [{ text: "в нерабочее время", value: rateLabel }] : []),
      zoneTerm,
    ],
    tables: [...(split ? [overtime] : []), worktime],
    note: legacyNote,
    footer: footerBase,
    summary,
  };
};

const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

const translit = (value: string) =>
  (value || "")
    .toLowerCase()
    .split("")
    .map((char) => TRANSLIT[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/**
 * Имя файла без расширения — латиницей: кириллицу в атрибуте `download` часть
 * браузеров игнорирует. Месяц — ключом с сервера (`report.month`): `periodFrom`
 * в UTC попадает на последний день предыдущего месяца.
 */
export const exportFileBase = (report: any, variant: ExportVariant) =>
  [
    "report",
    translit(report.company?.alias || "company"),
    report.month || String(report.periodFrom || "").slice(0, 7),
    ...(variant === "extra" ? ["sverh-tarifa"] : []),
  ]
    .filter(Boolean)
    .join("-");

export { wallClockAsUtc } from "./export-format.js";
