import { OVERLAP_META } from "./meta";

/**
 * Выгрузка «Диапазонов сетей» в Excel.
 *
 * `xlsx` подгружается динамически в момент нажатия — в чанк страницы он не
 * входит (тот же приём, что у отчётов).
 *
 * Выгружается ТО ЖЕ, что на экране: если включён фасет причины или задан поиск,
 * в книгу уедет сужённый набор. Иначе файл спорил бы с тем, что человек только
 * что отфильтровал.
 *
 * Имя файла — латиницей: кириллицу в `download` часть браузеров игнорирует, и
 * файл сохраняется как «download» без расширения.
 */
export const exportNetworksToExcel = async (entries) => {
  const XLSX = await import("xlsx");

  const rows = entries.map((entry) => ({
    Адрес: entry.address,
    Сеть: entry.network,
    Интерфейс: entry.interface,
    Устройство: entry.deviceName,
    Комментарий: entry.comment,
    Пересечение: entry.overlap ? OVERLAP_META[entry.overlap].label : "",
    Состояние: entry.disabled ? "отключён" : "",
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 20 },
    { wch: 18 },
    { wch: 22 },
    { wch: 20 },
    { wch: 30 },
    { wch: 20 },
    { wch: 12 },
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Диапазоны сетей");

  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "networks.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
