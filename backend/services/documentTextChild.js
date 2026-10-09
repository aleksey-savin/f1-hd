// Разбор документа в текст для AI-гайда. Здесь живёт ВЕСЬ разбор (PDF, DOCX, XLSX,
// TXT) — в одном месте, без дублей — и этот же файл служит дочерним процессом.
//
// Файл вложения чужой, а exceljs, mammoth и pdf-parse на нём способны съесть память
// или процессорное время так, что падает или замирает весь бэкенд: диапазон в узле
// определённых имён, `<col max="2000000000">`, сотни листов с ячейкой в колонке XFD,
// глубокая вложенность XML, стиль, который копируется в каждую строку. Поэтому
// attachmentExtractor.js запускает этот файл отдельным процессом (через /bin/sh, где
// ставятся лимиты дампа и процессорного времени, а затем exec; на Windows — fork) с
// потолком кучи и таймаутом и убивает его по SIGKILL: что бы ни случилось внутри,
// бэкенд цел.
//
// Протокол: родитель шлёт одно сообщение { data, mimetype }, ребёнок отвечает одним
// { ok: true, text } или { ok: false, error } (ошибка не длиннее 300 знаков) и
// выходит. Тяжёлые библиотеки подключаются лениво, внутри разбора: ребёнок грузит
// только то, что нужно его формату. Модуль не трогает логгер и хранилище (@/...),
// поэтому в ребёнке не нужен и module-alias.

const fs = require("node:fs");

const MAX_DOC_TEXT = 8000; // chars of extracted text kept per document
// Потолок работы над одним документом: сколько ячеек просматриваем, не больше
const MAX_SCANNED_CELLS = 2_000_000;
// Потолок индекса листа в книге: exceljs кладёт лист в разреженный массив по sheetId
// из файла, и workbook.worksheets обходит его целиком (sheetId 2147483647 — минуты)
const MAX_SHEET_SLOTS = 100_000;
// Текст ошибки, который уходит родителю и в лог, не длиннее: exceljs вшивает в
// сообщения куски самого файла (до десятков мегабайт)
const MAX_ERROR_CHARS = 300;
// Текст в ответе ребёнка не длиннее: ИИ берёт MAX_DOC_TEXT знаков, а гигантский текст
// документа не должен раздувать память бэкенда по дороге через IPC
const MAX_REPLY_CHARS = 1_000_000;

const PDF_MIME = new Set(["application/pdf", "application/pdf+a"]);
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEXT_MIME = new Set(["text/plain"]);

// Текст ячейки для строки CSV: у формулы — её результат, у даты — день в ISO
// (и время, если оно есть). Объединённые диапазоны не разворачиваются (см.
// xlsxToText): значение есть только у левой верхней ячейки диапазона.
const cellText = (cell) => {
  const raw = cell.value;
  const value =
    raw !== null && typeof raw === "object" && "result" in raw ? raw.result : raw;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Число вроде телефона в ячейке с форматом даты exceljs превращает в Invalid Date,
    // и toISOString() бросил бы RangeError на всю книгу. Исходное число к этому
    // моменту уже потеряно (дата — NaN), так что ячейка читается пустой.
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z")
      ? iso.slice(0, 10)
      : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  if (typeof value === "object") {
    const rich = (node) => (node?.richText || []).map((part) => part.text).join("");
    if (value.richText) return rich(value);
    // Гиперссылка: видимый текст, иногда сам rich text
    if (value.text !== undefined) {
      return typeof value.text === "object" ? rich(value.text) : String(value.text);
    }
    if (value.error !== undefined) return String(value.error);
    return "";
  }
  return String(value);
};

const csvField = (text) =>
  /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

// Каждый лист — «# имя» и его непустые строки CSV-строками: ту же форму AI-гайд
// получал от SheetJS (sheet_to_csv по листу). Строки из одних пустых ячеек
// пропускаются, чтение останавливается, когда текста уже хватает или когда
// выбран бюджет просмотра ячеек.
const xlsxToText = async (buffer) => {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  // Главная защита — изоляция процесса (см. шапку файла); три правки ниже нужны,
  // чтобы обычные враждебные файлы отваливались сразу, а не выжигали весь таймаут.
  // exceljs при загрузке разворачивает в объект на каждую ячейку диапазоны определённых
  // имён (одно $A$1:$XFD$1048576 в файле на 1,6 КБ — 17 миллиардов ячеек), а ИИ имена
  // не нужны. Поле приватное (exceljs 4.4.0): если обновление его переименует, упадёт
  // тест на такую книгу.
  workbook._definedNames = { model: [] };
  // Узлы mergeCells, dataValidations и cols exceljs тоже разворачивает по одному
  // объекту на ячейку или колонку (ref="A1:XFD1048576", max="2000000000"), а ИИ нужен
  // только текст ячеек: объединённые диапазоны не разворачиваются — значение остаётся
  // в левой верхней ячейке, остальные ячейки объединения пусты, как и в самом файле.
  await workbook.xlsx.load(buffer, { ignoreNodes: ["dataValidations", "mergeCells", "cols"] });
  // sheetId из файла становится индексом разреженного массива листов, а геттер
  // workbook.worksheets обходит его целиком: sheetId 2147483647 в файле на 1,5 КБ —
  // это минуты синхронного цикла. Проверяем длину массива, не трогая геттер.
  if (workbook._worksheets.length > MAX_SHEET_SLOTS) {
    throw new Error(`в книге листы с номерами до ${workbook._worksheets.length - 1}`);
  }
  // Лист из чужого файла безопасным считать нельзя: одна ячейка в колонке XFD в
  // каждой из миллиона строк — это 16 миллиардов ячеек. eachRow, getCell и columnCount
  // обходят всю ширину строки, а getCell ещё и создаёт пустые ячейки, поэтому
  // ходим findRow/findCell и считаем работу. Дальше MAX_DOC_TEXT текст не уйдёт.
  const parts = [];
  let length = 0;
  let scanned = 0;
  const full = () => length > MAX_DOC_TEXT || scanned > MAX_SCANNED_CELLS;
  for (const sheet of workbook.worksheets) {
    if (full()) break;
    length += sheet.name.length + 3;
    const rows = [];
    for (let number = 1; number <= sheet.rowCount && !full(); number += 1) {
      scanned += 1;
      const row = sheet.findRow(number);
      if (!row) continue;
      scanned += row.cellCount;
      const cells = [];
      let filled = false;
      for (let col = 1; col <= row.cellCount; col += 1) {
        const cell = row.findCell(col);
        const text = cell ? csvField(cellText(cell)) : "";
        filled = filled || text !== "";
        cells.push(text);
      }
      if (!filled) continue;
      const line = cells.join(",");
      length += line.length + 1;
      rows.push(line);
    }
    parts.push(`# ${sheet.name}\n${rows.join("\n")}`);
  }
  return parts.join("\n\n");
};

// Текст документа в этом же процессе; null — тип не из известных
const parseDocumentText = async (buffer, mimetype) => {
  if (PDF_MIME.has(mimetype)) {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (mimetype === DOCX_MIME) {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype === XLSX_MIME) {
    return xlsxToText(buffer);
  }

  if (TEXT_MIME.has(mimetype)) {
    return buffer.toString("utf8");
  }

  return null;
};

// При нехватке памяти ядро (OOM killer) должно убить разбор, а не бэкенд: ребёнок
// ставит себе oom_score_adj = 1000, то есть «убей меня первым». Поднять собственный
// счёт может любой процесс без привилегий (опустить — нельзя). Пишется только в самом
// ребёнке (runAsChild), а не при загрузке модуля: модуль подключает и бэкенд, ради
// констант и parseDocumentText, и ему такой счёт ни к чему. Вне Linux файла нет —
// try/catch, чтобы машины разработки на других системах не пострадали.
const preferOomKill = () => {
  try {
    fs.writeFileSync("/proc/self/oom_score_adj", "1000");
  } catch {
    // нет /proc или запись закрыта: разбор от этого не зависит
  }
};

// Дочерний процесс: одно сообщение внутрь, один ответ наружу и выход
const runAsChild = () => {
  preferOomKill();
  let replied = false;
  const reply = (message) => {
    if (replied) return;
    replied = true;
    process.send(message, () => process.exit(0));
  };
  const failure = (error) => ({
    ok: false,
    error: String(error?.message ?? error).slice(0, MAX_ERROR_CHARS),
  });

  // Родитель исчез — разбирать некому
  process.on("disconnect", () => process.exit(1));
  // Ошибка из обработчика потока exceljs вне цепочки промисов тоже должна дойти до родителя
  process.on("uncaughtException", (error) => reply(failure(error)));
  process.on("unhandledRejection", (error) => reply(failure(error)));
  process.once("message", async ({ data, mimetype }) => {
    try {
      const text = await parseDocumentText(data, mimetype);
      reply({
        ok: true,
        text: typeof text === "string" ? text.slice(0, MAX_REPLY_CHARS) : text,
      });
    } catch (error) {
      reply(failure(error));
    }
  });
};

if (require.main === module) runAsChild();

module.exports = {
  DOCX_MIME,
  MAX_DOC_TEXT,
  MAX_ERROR_CHARS,
  MAX_REPLY_CHARS,
  MAX_SCANNED_CELLS,
  MAX_SHEET_SLOTS,
  PDF_MIME,
  parseDocumentText,
  TEXT_MIME,
  XLSX_MIME,
};
