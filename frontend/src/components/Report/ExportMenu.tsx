import {
  RiDownload2Line,
  RiFileExcel2Line,
  RiFileTextLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { AnalyticsSummaryResponse } from "../../types/report";

import { exportAnalyticsToCsv, exportAnalyticsToExcel } from "./export";

// «Экспорт» в тулбаре «Сводки»: Excel (многолистовая книга) и CSV — прежняя
// функциональность легаси-кнопок одним меню. У «Динамики» экспорта не было —
// не добавляем.
const ExportMenu = ({ data }: { data: AnalyticsSummaryResponse | null }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" disabled={!data}>
        <RiDownload2Line />
        Экспорт
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        onSelect={() => {
          if (data) void exportAnalyticsToExcel(data);
        }}
      >
        <RiFileExcel2Line aria-hidden />
        Excel (.xlsx)
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          if (data) exportAnalyticsToCsv(data);
        }}
      >
        <RiFileTextLine aria-hidden />
        CSV
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export default ExportMenu;
