import { RiDownloadLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { orgTimezone } from "../../util/timezone-display";
import { fillWorkbook } from "./export-excel";
import {
  buildExportModel,
  exportFileBase,
  extraAvailability,
  type ExportVariant,
} from "./export-model";
import { renderExportHtml } from "./export-pdf";
import { reportDates } from "./report-zone";

/**
 * Выгрузка отчёта — PDF и Excel, в двух составах: полный отчёт и «только
 * работы сверх тарифа» (его отправляют, когда согласовать надо одну доплату).
 *
 * Что попадает в файл, решает `export-model` — одна модель на оба формата;
 * здесь только меню и доставка файла.
 *
 * PDF делается ОКНОМ ПЕЧАТИ, а не jsPDF: у встроенных шрифтов jsPDF нет
 * кириллицы, и отчёт вышел бы кракозябрами. Браузер рисует текст сам и
 * предлагает «Сохранить как PDF» (`export-pdf`).
 *
 * Excel пишет `exceljs` (`export-excel`) и подгружается динамически в момент
 * нажатия: в чанк страницы он не входит.
 *
 * Время работ — в поясе организации, как и в карточке, и пояс назван в файле:
 * он уходит клиенту без интерфейса вокруг, и понять, чьё это «19:30», ему
 * больше не по чему.
 */

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

// Заголовок группы пунктов — тем же языком, что метки секций на страницах
const GROUP_LABEL =
  "pt-2 pb-1 text-xs font-bold tracking-wider text-faint uppercase";

const ReportExportMenu = ({
  report,
  zone,
}: {
  report: any;
  /** Пояс организации из ответа сервера — тот же, что у карточки. */
  zone?: string | null;
}) => {
  const dates = reportDates(zone || orgTimezone());
  const extra = extraAvailability(report);

  const modelOf = (variant: ExportVariant) =>
    buildExportModel(report, variant, {
      shortDate: dates.shortDate,
      zoneLabel: dates.zoneLabel,
    });

  const exportPdf = (variant: ExportVariant) => {
    const html = renderExportHtml(modelOf(variant), {
      fileBase: exportFileBase(report, variant),
      madeAt: dates.shortDate(new Date()) || "",
      startLabel: (value) => dates.weekdayDateTime(value) || "",
    });

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    // Даём странице отрисоваться, иначе печать уходит с пустым телом
    setTimeout(() => printWindow.print(), 400);
  };

  const exportExcel = async (variant: ExportVariant) => {
    const loaded: any = await import("exceljs");
    const ExcelJS = loaded.default ?? loaded;
    const workbook = fillWorkbook(new ExcelJS.Workbook(), modelOf(variant), {
      zone: dates.zone,
    });
    const buffer = await workbook.xlsx.writeBuffer();
    // Кириллицу в имени файла часть браузеров игнорирует — имя латиницей,
    // а качаем сами через Blob
    download(
      new Blob([buffer], { type: XLSX_TYPE }),
      `${exportFileBase(report, variant)}.xlsx`,
    );
  };

  const items = (variant: ExportVariant, disabled = false) => (
    <>
      <DropdownMenuItem disabled={disabled} onSelect={() => exportPdf(variant)}>
        PDF (печать)
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => exportExcel(variant)}
      >
        Excel (.xlsx)
      </DropdownMenuItem>
    </>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <RiDownloadLine /> Экспорт
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className={GROUP_LABEL}>
          Полный отчёт
        </DropdownMenuLabel>
        {items("full")}

        {/* У почасовой услуги деления на тариф и «сверх тарифа» нет — и
            второго состава тоже; у остальных группа видна всегда, а когда
            таких работ в отчёте нет, погашена и говорит почему */}
        {extra !== "none" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={GROUP_LABEL}>
              Только работы сверх тарифа
            </DropdownMenuLabel>
            {items("extra", extra === "empty")}
            {extra === "empty" && (
              <div className="px-2 pb-1.5 text-xs text-faint">
                В этом отчёте таких работ нет
              </div>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ReportExportMenu;
