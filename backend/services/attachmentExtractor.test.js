// node --test services/attachmentExtractor.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const ExcelJS = require("exceljs");

// Счёт OOM этого процесса до загрузки модулей разбора: загрузка его менять не должна
// (его ставит себе только ребёнок, а бэкенд, подключающий модуль, — нет)
const readOomScore = () => {
  try {
    return fs.readFileSync("/proc/self/oom_score_adj", "utf8").trim();
  } catch {
    return null;
  }
};
const OOM_SCORE_BEFORE_LOAD = readOomScore();

const logger = require("@/utils/logger");
const storage = require("@/services/storage");
const {
  declaredZipSize,
  DOCUMENT_PARSE_TIMEOUT_MS,
  extractAttachments,
  extractDocumentText,
  MAX_DOC_BYTES,
  MAX_DOCUMENTS_PER_GUIDE,
  MAX_INFLATED_BYTES,
  MAX_PARSE_CHILDREN,
  MAX_ZIP_ENTRIES,
  PARSE_CHILD_CPU_SECONDS,
  PARSE_CHILD_HEAP_MB,
} = require("./attachmentExtractor");
const { MAX_ERROR_CHARS, MAX_REPLY_CHARS, parseDocumentText } = require("./documentTextChild");

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

// Книга собирается тем же exceljs — живой файл клиента в тест не кладём
const workbookBuffer = async () => {
  const workbook = new ExcelJS.Workbook();
  const servers = workbook.addWorksheet("Серверы");
  servers.addRow(["Имя", "Роль", "Заметка"]);
  servers.addRow(["srv-dc01", "контроллер домена", 'Касса, зал "2"']);
  servers.addRow([]);
  servers.addRow(["Итого", { formula: "1+1", result: 2 }, new Date(Date.UTC(2026, 11, 1))]);
  servers.getCell("A6").value = "Объединённая";
  servers.mergeCells("A6:B6");
  servers.getCell("A7").value = { richText: [{ text: "жирный " }, { text: "хвост" }] };
  servers.getCell("B7").value = { text: "ссылка", hyperlink: "https://example.ru" };
  workbook.addWorksheet("Пусто");
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

// ── Zip и книги вручную ────────────────────────────────────────────────────
// exceljs пишет только честные книги. Для проверки размера после распаковки и
// враждебных листов нужен контроль над содержимым и каталогом архива, поэтому
// минимальный zip (deflate, без zip64) собирается здесь же. declaredSize
// подменяет размер в каталоге: проверка читает только его.
const zipOf = (entries, comment = "") => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, declaredSize } of entries) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const packed = zlib.deflateRawSync(body, { level: 1 });
    const nameBytes = Buffer.from(name, "utf8");
    const crc = zlib.crc32(body);
    const size = declaredSize ?? body.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // версия для распаковки
    local.writeUInt16LE(0x0800, 6); // имена в UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0x21, 12); // дата 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...locals, directory, end, commentBytes]);
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PACKAGE_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="%TARGET%"/></Relationships>`;
const TYPES = (overrides) =>
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;

// Книга из одной страницы «Лист»: sheetData — XML строк как есть. Остальное — в
// options: beforeData и afterData — узлы листа до и после данных (cols, mergeCells,
// dataValidations …), workbookExtra — узлы книги после <sheets> (definedNames),
// sheetId — номер листа, packageRels — свой _rels/.rels, extraEntries — записи zip
const handmadeXlsx = (
  sheetData,
  { extraEntries = [], beforeData = "", afterData = "", workbookExtra = "", sheetId = 1, packageRels } = {},
) =>
  zipOf([
    {
      name: "[Content_Types].xml",
      data: TYPES(
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      ),
    },
    { name: "_rels/.rels", data: packageRels ?? PACKAGE_RELS.replace("%TARGET%", "xl/workbook.xml") },
    {
      name: "xl/workbook.xml",
      data: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист" sheetId="${sheetId}" r:id="rId1"/></sheets>${workbookExtra}</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${beforeData}<sheetData>${sheetData}</sheetData>${afterData}</worksheet>`,
    },
    ...extraEntries,
  ]);

const inlineRow = (number, text) =>
  `<row r="${number}"><c r="A${number}" t="inlineStr"><is><t>${text}</t></is></c></row>`;

const PRINTER_PARAGRAPH = "<w:p><w:r><w:t>Не работает принтер</w:t></w:r></w:p>";

// Документ из тела body (по умолчанию — один абзац)
const handmadeDocx = (extraEntries = [], body = PRINTER_PARAGRAPH) =>
  zipOf([
    {
      name: "[Content_Types].xml",
      data: TYPES(
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      ),
    },
    { name: "_rels/.rels", data: PACKAGE_RELS.replace("%TARGET%", "word/document.xml") },
    {
      name: "word/document.xml",
      data: `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    },
    ...extraEntries,
  ]);

// Медиа-вложение из нулей: в архиве ~16 КБ, после распаковки — потолок целиком
const zerosEntry = (name) => ({ name, data: Buffer.alloc(MAX_INFLATED_BYTES) });

// Записи-«наполнитель» (customXml/item1.xml …): exceljs их читает и пропускает, так
// что книга остаётся честной, а записей в архиве становится ровно count
const paddingEntries = (count) =>
  Array.from({ length: count }, (_, n) => ({ name: `customXml/item${n + 1}.xml`, data: "<x/>" }));

const EMPTY_SHEET = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;

// Книга из count листов с одним и тем же XML sheet (по умолчанию пустым): у каждого
// листа своя запись в zip
const manySheetsXlsx = (count, sheet = EMPTY_SHEET) => {
  const numbers = Array.from({ length: count }, (_, n) => n + 1);
  const sheetTags = numbers.map((n) => `<sheet name="S${n}" sheetId="${n}" r:id="rId${n}"/>`);
  const relTags = numbers.map(
    (n) =>
      `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
  );
  return zipOf([
    { name: "[Content_Types].xml", data: TYPES("") },
    { name: "_rels/.rels", data: PACKAGE_RELS.replace("%TARGET%", "xl/workbook.xml") },
    {
      name: "xl/workbook.xml",
      data: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags.join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relTags.join("")}</Relationships>`,
    },
    ...numbers.map((n) => ({ name: `xl/worksheets/sheet${n}.xml`, data: sheet })),
  ]);
};

// Книга с одним стилем, у которого имя шрифта — миллион знаков (в zip ~1 КБ), и
// rowCount строк с этим стилем: exceljs копирует стиль в каждую строку через JSON
const rowStyleXlsx = (rowCount) => {
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><name val="${"A".repeat(1_000_000)}"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  const rows = Array.from({ length: rowCount }, (_, n) => `<row r="${n + 1}" s="1"/>`).join("");
  return handmadeXlsx(rows + inlineRow(rowCount + 1, "начало"), {
    extraEntries: [{ name: "xl/styles.xml", data: styles }],
  });
};

// Минимальный PDF с одной строкой текста: смещения xref считаются по ходу сборки
const makePdf = (text) => {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
};

const attachment = (mimetype, name = "file.bin") => ({
  name,
  originalName: "Выгрузка",
  mimetype,
});

// ── Помощники для проверки изоляции ────────────────────────────────────────

// Враждебный файл в дочернем процессе: extractDocumentText обязан вернуть null,
// записать в лог ОДНУ строку про сбой изоляции, а тестовый процесс не пострадать:
// цикл событий крутится, память не выросла. Строку про имя и причину отдаёт назад.
const expectSkipped = async (t, buffer, mimetype, name) => {
  const log = t.mock.method(logger, "log", () => {});
  const rssBefore = process.memoryUsage().rss;
  let ticks = 0;
  const ticker = setInterval(() => {
    ticks += 1;
  }, 20);
  const started = performance.now();
  const text = await within(40_000, extractDocumentText(buffer, mimetype, { name }), name);
  const ms = performance.now() - started;
  clearInterval(ticker);
  const grownMb = (process.memoryUsage().rss - rssBefore) / 1048576;

  assert.equal(text, null);
  assert.ok(ms < 20_000, `${ms.toFixed(0)} мс`);
  assert.ok(ticks >= Math.floor(ms / 250), `цикл событий: ${ticks} тиков за ${ms.toFixed(0)} мс`);
  assert.ok(grownMb < 200, `RSS теста вырос на ${grownMb.toFixed(0)} МБ`);
  const warns = log.mock.calls.filter(
    ({ arguments: [level, message] }) =>
      level === "warn" && message === "AI guide: document parse failed in isolation",
  );
  assert.equal(warns.length, 1);
  const fields = warns[0].arguments[2];
  assert.equal(fields.name, name);
  assert.match(fields.reason, /^(signal \w+|timeout \d+ ms)$/);
  return fields;
};

// Поддельный ребёнок для проверки родителя: скрипт кладётся во временную папку
const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d2-child-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const writeChild = (dir, source, name = "child.js") => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source);
  return file;
};

// Честная маленькая книга: проходит быстрые проверки и доходит до запуска ребёнка
const smallBook = () => handmadeXlsx(inlineRow(1, "начало"));

// Вызов, который мог бы зависнуть (ребёнка не убили, слот не отдали), роняет тест
// понятным сообщением за ms, а не вешает весь прогон
const within = (ms, promise, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label}: нет ответа за ${ms} мс`)), ms).unref();
    }),
  ]);

// Настоящий ребёнок напрямую, без родителя: что именно он присылает по протоколу.
// Возвращает все его сообщения и как он закончился. `execArgv` — флаги сверх кучи
// (например, --require с хуком, который ломает запись oom_score_adj).
const askChild = (data, mimetype, execArgv = []) =>
  new Promise((resolve, reject) => {
    const child = childProcess.fork(path.join(__dirname, "documentTextChild.js"), [], {
      execArgv: ["--max-old-space-size=256", ...execArgv],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {},
    });
    const messages = [];
    child.on("message", (message) => messages.push(message));
    child.once("error", reject);
    const killer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.once("close", (code, signal) => {
      clearTimeout(killer);
      resolve({ messages, code, signal });
    });
    child.send({ data, mimetype });
  });

const warnLines = (log, message) =>
  log.mock.calls.filter(
    ({ arguments: [level, text] }) => level === "warn" && text === message,
  );
const ISOLATION_FAILED = "AI guide: document parse failed in isolation";
const TOO_MANY_DOCUMENTS = "AI guide: too many documents, skipping the rest";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Процесс ещё работает? Зомби уже мёртв: он лишь ждёт, пока init подберёт его код
// выхода (родителя нет — ребёнок усыновлён), так что состояние Z считается концом.
// Без /proc остаётся kill(pid, 0).
const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === "EPERM";
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat[stat.lastIndexOf(")") + 2] !== "Z";
  } catch {
    return true;
  }
};

// Свежая копия модуля: он забирает spawn при загрузке, поэтому подмену spawn он видит
// только у новой копии (общий кэш модулей возвращается на место по окончании теста)
const freshExtractor = (t) => {
  const modulePath = require.resolve("./attachmentExtractor");
  const shared = require.cache[modulePath];
  delete require.cache[modulePath];
  t.after(() => {
    require.cache[modulePath] = shared;
  });
  return require("./attachmentExtractor");
};

// ── Чтение листа в процессе ────────────────────────────────────────────────
// Эти тесты гоняют сам разбор (parseDocumentText) прямо в тестовом процессе: так
// быстро, и они проверяют быстрые отказы на враждебных, но обычных файлах. В
// бэкенде тот же разбор идёт в дочернем процессе, поэтому регресс здесь — это
// потеря быстрого отказа, а не падение бэкенда.

test("xlsx: строка из одних пустых ячеек пропускается", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Лист");
  sheet.addRow(["первая"]);
  sheet.getCell("A2").font = { bold: true }; // ячейка с оформлением, но без значения
  sheet.addRow(["третья"]);

  const text = await parseDocumentText(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    XLSX_MIME,
  );

  assert.equal(text, "# Лист\nпервая\nтретья");
});

// Одна ячейка в колонке XFD (16 384-й) в каждой строке: обход строки на полную
// ширину строил миллиарды пустых ячеек, а 5000 таких строк (файл 27 КБ) роняли
// весь процесс на «heap out of memory» — try/catch это не ловит. На 300 строках
// прежний код не падает по памяти (~1,3 ГБ), а думает ~3,5 с и собирает ~5 млн
// знаков, то есть тест падает по времени и длине, а не убивает прогон.
// { timeout } у node:test синхронный цикл не прервёт, а vm-таймаут из соседних
// тестов не накрывает продолжение асинхронной загрузки exceljs после await,
// поэтому границы проверяются после вызова — с запасом на загруженную машину
// (с правкой вызов занимает ~60 мс).
test(
  "xlsx: ячейка в колонке XFD в каждой из 300 строк читается быстро и не раздувает текст",
  { timeout: 10000 },
  async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Широкая");
    for (let row = 1; row <= 300; row += 1) sheet.getCell(`XFD${row}`).value = 1;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const started = performance.now();
    const text = await parseDocumentText(buffer, XLSX_MIME);
    const ms = performance.now() - started;

    assert.ok(
      ms < 1000 && text.length <= 20_000,
      `${ms.toFixed(0)} мс, текст ${text.length} знаков`,
    );
  },
);

// Номер строки в сотни миллионов: перебор «строка за строкой» до него — это
// сотни миллионов шагов впустую. Случай из ревью (строка 4 294 967 290, файл
// 2 КБ) exceljs-писателем не собрать — он сам обходит разреженный массив минутами,
// а прежний код на нём думал больше двух минут синхронно. Здесь собран вручную
// файл со строкой 100 000 000: прежний код читает его ~3 с, то есть регресс
// падает на пороге времени, а не вешает прогон. Лист дальше бюджета просмотра
// не читается — «конец» в текст не попадает.
test(
  "xlsx: строка с номером в сто миллионов не заставляет перебирать пустоту",
  { timeout: 10000 },
  async () => {
    const buffer = handmadeXlsx(inlineRow(1, "начало") + inlineRow(100_000_000, "конец"));

    const started = performance.now();
    const text = await parseDocumentText(buffer, XLSX_MIME);
    const ms = performance.now() - started;

    assert.ok(ms < 1000, `${ms.toFixed(0)} мс`);
    assert.equal(text, "# Лист\nначало");
  },
);

test("xlsx: длинный лист читается до предела текста, а не целиком", async (t) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Журнал");
  for (let n = 1; n <= 2000; n += 1) sheet.addRow([`событие ${n}`, `описание ${n}`]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  // Чтение останавливается на первой строке, после которой текст перешёл 8000 знаков
  const text = await parseDocumentText(buffer, XLSX_MIME);
  assert.ok(text.length > 8000 && text.length < 8200, `текст ${text.length} знаков`);

  t.mock.method(storage, "getObjectBuffer", async () => buffer);
  const result = await extractAttachments([attachment(XLSX_MIME)]);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].text.length, 8001);
  assert.ok(result.documents[0].text.endsWith("…"));
});

// Число в ячейке с форматом даты (телефон в колонке «дата») exceljs превращает в
// Invalid Date, и toISOString() бросал RangeError на всю книгу. Само число к этому
// моменту уже потеряно (дата — NaN), поэтому ячейка читается пустой, а остальные
// строки остаются.
test("xlsx: число в ячейке с форматом даты не роняет книгу целиком", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Контакты");
  sheet.addRow(["Имя", "Телефон"]);
  sheet.addRow(["Иванов", 79991234567]);
  sheet.getCell("B2").numFmt = "dd.mm.yyyy";
  sheet.addRow(["Петров", new Date(Date.UTC(2026, 11, 1))]);

  const text = await parseDocumentText(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    XLSX_MIME,
  );

  assert.equal(text, ["# Контакты", "Имя,Телефон", "Иванов,", "Петров,2026-12-01"].join("\n"));
});

// ── Тот же текст через дочерний процесс ────────────────────────────────────

test("xlsx: лист — заголовком «# имя», непустые строки — CSV (через дочерний процесс)", async () => {
  const text = await extractDocumentText(await workbookBuffer(), XLSX_MIME);

  assert.equal(
    text,
    [
      "# Серверы",
      "Имя,Роль,Заметка",
      'srv-dc01,контроллер домена,"Касса, зал ""2"""',
      "Итого,2,2026-12-01",
      // Объединённые диапазоны не разворачиваются (узел mergeCells не читается, см.
      // xlsxToText): значение лежит в левой верхней ячейке, а второй, пустой
      // ячейки объединения у строки нет — отсюда нет и хвостовой запятой
      "Объединённая",
      "жирный хвост,ссылка",
      "",
      "# Пусто",
      "",
    ].join("\n"),
  );
});

test("docx: обычный документ читается через дочерний процесс", async () => {
  const text = await extractDocumentText(handmadeDocx(), DOCX_MIME);

  assert.equal(text.trim(), "Не работает принтер");
});

test("pdf: текст читается через дочерний процесс", async () => {
  const text = await extractDocumentText(makePdf("Hello AI guide"), PDF_MIME);

  assert.ok(text.includes("Hello AI guide"), JSON.stringify(text));
});

test("текст документа обрезается на 8000 знаках с многоточием", async (t) => {
  let served;
  t.mock.method(storage, "getObjectBuffer", async () => served);
  const textAttachment = [attachment("text/plain")];

  served = Buffer.from("а".repeat(9000), "utf8");
  const long = await extractAttachments(textAttachment);
  assert.equal(long.documents[0].text, `${"а".repeat(8000)}…`);

  served = Buffer.from("а".repeat(8000), "utf8");
  const exact = await extractAttachments(textAttachment);
  assert.equal(exact.documents[0].text, "а".repeat(8000));
});

// Ответ ребёнка по IPC ограничен: ИИ берёт 8000 знаков, а текст огромного документа
// не должен раздувать память бэкенда. Обычные документы короче и приходят целиком.
test("ответ ребёнка не длиннее MAX_REPLY_CHARS знаков", async () => {
  const body = `<w:p><w:r><w:t>${"а".repeat(MAX_REPLY_CHARS + 200_000)}</w:t></w:r></w:p>`;

  const text = await extractDocumentText(handmadeDocx([], body), DOCX_MIME);

  assert.equal(text.length, MAX_REPLY_CHARS);
  assert.ok(text.startsWith("аааа"));
});

// ── Бомбы разбора внутри exceljs.load ──────────────────────────────────────
// exceljs при загрузке разворачивает диапазон узлов mergeCells и dataValidations
// в объект на каждую ячейку: один ref="A1:XFD1048576" в файле на пару КБ — это
// 17 миллиардов ячеек. Без ignoreNodes ребёнок падает по памяти (SIGABRT) и
// extractDocumentText возвращает null, а тест, ждущий текст, падает.

test("xlsx: объединение A1:XFD1048576 в файле на 2 КБ не разворачивается в ячейки", async () => {
  const bomb = handmadeXlsx(inlineRow(1, "начало"), {
    afterData: '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>',
  });
  assert.ok(bomb.length < 4096, `файл ${bomb.length} байт`);

  assert.equal(await extractDocumentText(bomb, XLSX_MIME), "# Лист\nначало");
});

test("xlsx: проверка данных на A1:XFD1048576 в файле на 2 КБ не разворачивается", async () => {
  const bomb = handmadeXlsx(inlineRow(1, "начало"), {
    afterData:
      '<dataValidations count="1"><dataValidation type="list" sqref="A1:XFD1048576"><formula1>"да,нет"</formula1></dataValidation></dataValidations>',
  });
  assert.ok(bomb.length < 4096, `файл ${bomb.length} байт`);

  assert.equal(await extractDocumentText(bomb, XLSX_MIME), "# Лист\nначало");
});

// ── Быстрые отказы: обычные враждебные файлы не выжигают таймаут ───────────
// Главная защита — изоляция (ниже), но эти три формы закрыты ещё и внутри разбора,
// чтобы ребёнок не доживал до SIGKILL: без правки он падает по памяти или виснет и
// extractDocumentText возвращает null через 7–15 с вместо ответа за доли секунды.

// RC-1: одно определённое имя на весь лист — exceljs разворачивает его в объект на
// ячейку прямо при загрузке книги (до листов, ignoreNodes сюда не достаёт). Правка
// опирается на приватное поле exceljs: если обновление его переименует, этот тест
// упадёт — бомба снова убьёт ребёнка.
test("xlsx: определённое имя на весь лист в файле на 2 КБ не разворачивается в ячейки", async () => {
  const bomb = handmadeXlsx(inlineRow(1, "начало"), {
    workbookExtra:
      '<definedNames><definedName name="Big">Лист!$A$1:$XFD$1048576</definedName></definedNames>',
  });
  assert.ok(bomb.length < 4096, `файл ${bomb.length} байт`);

  assert.equal(await extractDocumentText(bomb, XLSX_MIME), "# Лист\nначало");
});

// RC-2: <col max="2000000000"> — exceljs заводит объект на каждую колонку из диапазона
test("xlsx: колонки до двух миллиардов в файле на 2 КБ не разворачиваются в объекты", async () => {
  for (const col of [
    '<col min="1" max="2000000000" width="10" customWidth="1"/>',
    '<col min="2000000000" max="2000000000" width="10" customWidth="1"/>',
  ]) {
    const bomb = handmadeXlsx(inlineRow(1, "начало"), { beforeData: `<cols>${col}</cols>` });
    assert.ok(bomb.length < 4096, `файл ${bomb.length} байт`);

    assert.equal(await extractDocumentText(bomb, XLSX_MIME), "# Лист\nначало", col);
  }
});

// RC-3: sheetId из файла — индекс разреженного массива листов, а workbook.worksheets
// обходит его целиком: 2147483647 — это минуты синхронного цикла, который не прервёт
// ни try/catch, ни Worker. Теперь книга с таким номером отвергается сразу.
test("xlsx: sheetId 2147483647 в файле на 2 КБ отвергается сразу, а не виснет", async () => {
  const bomb = handmadeXlsx(inlineRow(1, "начало"), { sheetId: 2147483647 });
  assert.ok(bomb.length < 4096, `файл ${bomb.length} байт`);

  const started = performance.now();
  await assert.rejects(extractDocumentText(bomb, XLSX_MIME, { name: "sheetid.xlsx" }), /листы с номерами/);
  const ms = performance.now() - started;

  assert.ok(ms < 10_000, `${ms.toFixed(0)} мс`);
});

// ── Изоляция: бомбы, которых не закрыть ни опцией, ни потолком ─────────────
// Файлы маленькие и честные по размеру (меньше всех потолков), но внутри exceljs и
// mammoth они съедают память: ребёнок с кучей в 256 МБ падает (SIGABRT) за 3–5 с, и
// extractDocumentText возвращает null. Тестовый процесс при этом не страдает.
// Формы взяты из ревью (RC-4, RC-5, RI-1, RI-2).

// RC-4: у каждой строки с атрибутом s стиль копируется через JSON, а размер стиля
// задаёт файл (имя шрифта в миллион знаков сжимается до ~1 КБ)
test("изоляция: стиль в миллион знаков, скопированный в тысячу строк, не роняет бэкенд", async (t) => {
  const bomb = rowStyleXlsx(1000);
  assert.ok(bomb.length < 16 * 1024, `файл ${bomb.length} байт`);

  await expectSkipped(t, bomb, XLSX_MIME, "rc4-row-style.xlsx");
});

// RC-5: ячейка в колонке XFD заводит на каждом листе 16 384 объекта колонок
// (~2 МБ), а записей в архиве меньше потолка в 2000
test("изоляция: 600 листов с ячейкой в XFD не роняют бэкенд", async (t) => {
  const bomb = manySheetsXlsx(
    600,
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="XFD1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
  );
  assert.ok(declaredZipSize(bomb).entries < MAX_ZIP_ENTRIES, "записей меньше потолка");

  await expectSkipped(t, bomb, XLSX_MIME, "rc5-sheets.xlsx");
});

// RI-1: сакс держит объект на каждый открытый уровень, а сколько уровней — решает файл
test("изоляция: вложенность в два миллиона уровней в xlsx не роняет бэкенд", async (t) => {
  const depth = 2_000_000;
  const bomb = handmadeXlsx(inlineRow(1, "x"), {
    afterData: `<foo>${"<a>".repeat(depth)}${"</a>".repeat(depth)}</foo>`,
  });
  assert.ok(bomb.length < 200 * 1024, `файл ${bomb.length} байт`);
  assert.ok(declaredZipSize(bomb).bytes < MAX_INFLATED_BYTES, "заявлено меньше 16 МиБ");

  await expectSkipped(t, bomb, XLSX_MIME, "ri1-nesting.xlsx");
});

test("изоляция: вложенность в два миллиона уровней в docx не роняет бэкенд", async (t) => {
  const depth = 2_000_000;
  const bomb = handmadeDocx([], `${PRINTER_PARAGRAPH}${"<a>".repeat(depth)}${"</a>".repeat(depth)}`);
  assert.ok(bomb.length < 200 * 1024, `файл ${bomb.length} байт`);
  assert.ok(declaredZipSize(bomb).bytes < MAX_INFLATED_BYTES, "заявлено меньше 16 МиБ");

  await expectSkipped(t, bomb, DOCX_MIME, "ri1-nesting.docx");
});

// RI-2: mammoth тратит ~140 байт памяти на байт XML из мелких элементов, а потолок
// в 16 МиБ откалиброван на листах exceljs: 15,5 МиБ абзацев — файл в 100 КБ
test("изоляция: 15,5 МиБ мелких абзацев в docx не роняют бэкенд", async (t) => {
  const paragraph = "<w:p><w:r><w:t>x</w:t></w:r></w:p>";
  const bomb = handmadeDocx([], paragraph.repeat(451_474));
  assert.ok(bomb.length < 200 * 1024, `файл ${bomb.length} байт`);
  assert.ok(declaredZipSize(bomb).bytes < MAX_INFLATED_BYTES, "заявлено меньше 16 МиБ");

  await expectSkipped(t, bomb, DOCX_MIME, "ri2-flat.docx");
});

// Сквозная проверка: после упавшего ребёнка вложения обрабатываются дальше, слот
// освобождён, а в лог идёт одна строка с именем вложения
test("extractAttachments: вложение-бомба пропускается, остальные читаются", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const depth = 2_000_000;
  const bomb = handmadeXlsx(inlineRow(1, "x"), {
    afterData: `<foo>${"<a>".repeat(depth)}${"</a>".repeat(depth)}</foo>`,
  });
  const files = { "bomb.xlsx": bomb, "ok.docx": handmadeDocx() };
  t.mock.method(storage, "getObjectBuffer", async (name) => files[name]);

  const result = await extractAttachments([
    attachment(XLSX_MIME, "bomb.xlsx"),
    attachment(DOCX_MIME, "ok.docx"),
  ]);

  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].text, "Не работает принтер");
  const failed = warnLines(log, ISOLATION_FAILED);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].arguments[2].name, "bomb.xlsx");
  assert.equal(warnLines(log, "AI guide: failed to read attachment").length, 0);
});

// ── Дочерний процесс: параметры, таймаут, сбои, очередь ────────────────────

test("изоляция: потолки — куча 256 МБ, 15 с, 60 с процессора, два ребёнка, ошибка до 300 знаков, ответ до миллиона", () => {
  assert.equal(PARSE_CHILD_HEAP_MB, 256);
  assert.equal(DOCUMENT_PARSE_TIMEOUT_MS, 15_000);
  assert.equal(PARSE_CHILD_CPU_SECONDS, 60);
  assert.equal(MAX_PARSE_CHILDREN, 2);
  assert.equal(MAX_ERROR_CHARS, 300);
  assert.equal(MAX_REPLY_CHARS, 1_000_000);
  assert.equal(MAX_DOCUMENTS_PER_GUIDE, 10);
});

// Протокол самого ребёнка (documentTextChild.js как процесс): на одно сообщение —
// ровно один ответ { ok, text } и выход с кодом 0; текст неизвестного типа — null
test("ребёнок: на одно сообщение — один ответ { ok: true, text } и выход с кодом 0", async () => {
  const read = await askChild(smallBook(), XLSX_MIME);
  assert.deepEqual(read.messages, [{ ok: true, text: "# Лист\nначало" }]);
  assert.equal(read.code, 0);
  assert.equal(read.signal, null);

  const unknown = await askChild(Buffer.from("PK"), "application/zip");
  assert.deepEqual(unknown.messages, [{ ok: true, text: null }]);
  assert.equal(unknown.code, 0);
});

// Ребёнок режет ошибку сам, до отправки: родитель режет ещё раз, но ответ по IPC
// не должен нести десять мегабайт куска файла
test("ребёнок: ошибка разбора в его ответе — ровно 300 знаков, а не весь кусок файла", async () => {
  const packageRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Foo x="${"A".repeat(10 * 1024 * 1024)}"/></Relationships>`;
  const bomb = handmadeXlsx(inlineRow(1, "начало"), { packageRels });

  const { messages, code } = await askChild(bomb, XLSX_MIME);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].ok, false);
  assert.equal(messages[0].error.length, 300);
  assert.match(messages[0].error, /^Unexpected xml node/);
  assert.equal(code, 0);
});

// Ребёнок, который ничего не отвечает, убивается по таймауту, а не остаётся висеть
test("изоляция: ребёнок, не ответивший за таймаут, убивается (SIGKILL), документ пропускается", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const dir = tempDir(t);
  const pidFile = path.join(dir, "pid");
  // Сам выходит, когда родитель исчез, чтобы упавший тест не оставил процесс-сироту
  const child = writeChild(
    dir,
    `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
     process.on("disconnect", () => process.exit(0));
     process.on("message", () => {});
     setInterval(() => {}, 1000);`,
  );

  const started = performance.now();
  const text = await within(
    30_000,
    extractDocumentText(smallBook(), XLSX_MIME, {
      name: "sleeper.xlsx",
      _childPath: child,
      _timeoutMs: 1000,
    }),
    "ребёнок-соня",
  );
  const ms = performance.now() - started;

  assert.equal(text, null);
  assert.ok(ms >= 900 && ms < 10_000, `${ms.toFixed(0)} мс`);
  const failed = warnLines(log, ISOLATION_FAILED);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].arguments[2].name, "sleeper.xlsx");
  assert.equal(failed[0].arguments[2].reason, "timeout 1000 ms");
  // К моменту ответа ребёнка уже нет: процесс с таким pid не существует
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

// Ребёнок ответил, но не выходит (держит канал): ответ не теряется, а процесс
// добивается через 2 секунды, чтобы не копить зависших детей
test("изоляция: ребёнок, ответивший и не вышедший, добивается, а ответ сохраняется", async (t) => {
  const dir = tempDir(t);
  const pidFile = path.join(dir, "pid");
  const child = writeChild(
    dir,
    `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
     process.on("disconnect", () => process.exit(0));
     process.once("message", () => process.send({ ok: true, text: "ответил" }, () => setInterval(() => {}, 1000)));`,
  );

  const started = performance.now();
  const text = await within(
    40_000,
    extractDocumentText(smallBook(), XLSX_MIME, { _childPath: child, _timeoutMs: 30_000 }),
    "ребёнок, не вышедший после ответа",
  );
  const ms = performance.now() - started;

  assert.equal(text, "ответил");
  assert.ok(ms >= 1800 && ms < 15_000, `${ms.toFixed(0)} мс`);
  assert.throws(() => process.kill(Number(fs.readFileSync(pidFile, "utf8")), 0), { code: "ESRCH" });
});

// Любой сбой ребёнка — null и одна строка в лог с причиной, без текста файла
test("изоляция: сбои ребёнка (код выхода, сигнал, молчание, мусор в ответе) — документ пропускается", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const dir = tempDir(t);
  const cases = [
    ["код выхода 3", `process.once("message", () => process.exit(3));`, /^exit code 3$/],
    ["убит сигналом", `process.once("message", () => process.kill(process.pid, "SIGKILL"));`, /^signal SIGKILL$/],
    ["вышел без ответа", `process.once("message", () => process.exit(0));`, /^exit code 0$/],
    ["ответил мусором", `process.once("message", () => process.send("мусор", () => process.exit(0)));`, /^bad reply$/],
    ["текст не строкой", `process.once("message", () => process.send({ ok: true, text: 12345 }, () => process.exit(0)));`, /^bad reply$/],
  ];

  for (const [label, source, reason] of cases) {
    log.mock.resetCalls();
    const child = writeChild(dir, source);

    const text = await extractDocumentText(smallBook(), XLSX_MIME, {
      name: "broken.xlsx",
      _childPath: child,
      _timeoutMs: 10_000,
    });

    assert.equal(text, null, label);
    const failed = warnLines(log, ISOLATION_FAILED);
    assert.equal(failed.length, 1, label);
    assert.match(failed[0].arguments[2].reason, reason, label);
    assert.deepEqual(
      Object.keys(failed[0].arguments[2]).sort(),
      ["bytes", "mimetype", "name", "queuedMs", "reason", "runMs"],
      `${label}: в строке только метаданные, без содержимого`,
    );
  }

  // Ребёнок, которого нет вовсе, ведёт себя так же: node выходит с кодом 1
  log.mock.resetCalls();
  const missing = await extractDocumentText(smallBook(), XLSX_MIME, {
    _childPath: path.join(dir, "нет-такого.js"),
    _timeoutMs: 10_000,
  });
  assert.equal(missing, null);
  assert.match(warnLines(log, ISOLATION_FAILED)[0].arguments[2].reason, /^exit code 1$/);
});

// Ребёнок не запустился: spawn бросил (EAGAIN: кончились процессы) или сообщил об
// ошибке событием (нет /bin/sh). Настоящий spawn так не сломать, поэтому свежая копия
// модуля грузится с подменённым spawn (модуль забирает его при загрузке; общий кэш
// модулей возвращается на место). Документ пропускается с одной строкой в логе, а
// слоты целы: после трёх сбоев подряд (больше MAX_PARSE_CHILDREN) обычный документ
// читается настоящим ребёнком, и ответ не ждёт страховочного таймера в 5 секунд.
test("изоляция: ребёнок не запустился (spawn бросил или сообщил об ошибке) — документ пропускается, слоты целы", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const realSpawn = childProcess.spawn;
  let mode = "throw";
  t.mock.method(childProcess, "spawn", (...args) => {
    if (mode === "throw") throw new Error("spawn EAGAIN");
    if (mode === "error-event") {
      const child = new EventEmitter();
      Object.assign(child, { pid: undefined, exitCode: null, signalCode: null, kill: () => false });
      child.send = (message, callback) => {
        process.nextTick(callback, new Error("канал закрыт"));
        return false;
      };
      process.nextTick(() => child.emit("error", new Error("spawn /bin/sh ENOENT")));
      return child;
    }
    return realSpawn(...args);
  });
  const modulePath = require.resolve("./attachmentExtractor");
  const shared = require.cache[modulePath];
  delete require.cache[modulePath];
  t.after(() => {
    require.cache[modulePath] = shared;
  });
  const fresh = require("./attachmentExtractor");

  for (const [kind, reason] of [
    ["throw", /^spawn failed: spawn EAGAIN$/],
    ["error-event", /^child error: spawn \/bin\/sh ENOENT$/],
  ]) {
    mode = kind;
    log.mock.resetCalls();
    const started = performance.now();
    const results = await within(
      10_000,
      Promise.all(
        Array.from({ length: MAX_PARSE_CHILDREN + 1 }, (_, n) =>
          fresh.extractDocumentText(smallBook(), XLSX_MIME, { name: `no-start-${n}.xlsx` }),
        ),
      ),
      kind,
    );
    const ms = performance.now() - started;

    assert.deepEqual(results, [null, null, null], kind);
    assert.ok(ms < 2000, `${kind}: ${ms.toFixed(0)} мс`);
    const failed = warnLines(log, ISOLATION_FAILED);
    assert.equal(failed.length, 3, kind);
    for (const line of failed) {
      assert.match(line.arguments[2].reason, reason, kind);
      assert.deepEqual(
        Object.keys(line.arguments[2]).sort(),
        ["bytes", "mimetype", "name", "queuedMs", "reason", "runMs"],
        kind,
      );
    }
  }

  mode = "real";
  assert.match(await fresh.extractDocumentText(smallBook(), XLSX_MIME), /начало/);
});

// EMFILE/ENFILE при запуске: Node возвращает управление из spawn ДО настройки IPC-канала,
// поэтому у объекта нет ни send, ни pid, а причину он сообщает событием 'error' на
// следующем тике. Раньше родитель звал send вслепую: TypeError «child.send is not a
// function» ронял вызов, и вложение попадало в лог как «не удалось прочитать», а не как
// сбой изоляции. И kill() в этом окне звать нельзя: у объекта нет pid, и сигнал уходит в
// неинициализированный pid из его handle (на ревью так убили сам процесс). Подставной
// spawn ведёт себя так же: exitCode остаётся null до ошибки, kill записывает вызовы.
test("изоляция: spawn не дал IPC-канала (EMFILE) — сбой изоляции, а не «не удалось прочитать», kill не зовётся", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const kills = [];
  t.mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    Object.assign(child, { pid: undefined, exitCode: null, signalCode: null });
    child.kill = (signal) => {
      kills.push(signal);
      return false;
    };
    process.nextTick(() =>
      child.emit("error", Object.assign(new Error("spawn /bin/sh EMFILE"), { code: "EMFILE" })),
    );
    return child;
  });
  const fresh = freshExtractor(t);

  // Напрямую: null, одна строка про изоляцию с причиной, без исключения
  const text = await within(
    10_000,
    fresh.extractDocumentText(smallBook(), XLSX_MIME, { name: "emfile.xlsx" }),
    "EMFILE",
  );
  assert.equal(text, null);
  const failed = warnLines(log, ISOLATION_FAILED);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].arguments[2].name, "emfile.xlsx");
  assert.equal(failed[0].arguments[2].reason, "child error: spawn /bin/sh EMFILE");
  assert.deepEqual(kills, [], "kill() вызван у ребёнка без pid");

  // Сквозь extractAttachments: пропущенный документ, строка про изоляцию, без «не удалось
  // прочитать вложение»
  log.mock.resetCalls();
  t.mock.method(storage, "getObjectBuffer", async () => smallBook());
  const result = await within(
    10_000,
    fresh.extractAttachments([attachment(XLSX_MIME, "emfile.xlsx")]),
    "extractAttachments",
  );
  assert.deepEqual(result, { images: [], documents: [] });
  assert.equal(warnLines(log, ISOLATION_FAILED).length, 1);
  assert.equal(warnLines(log, "AI guide: failed to read attachment").length, 0);

  // Слоты целы: сбоев подряд больше, чем слотов, и никто не ждёт страховочного таймера
  log.mock.resetCalls();
  const started = performance.now();
  const results = await within(
    10_000,
    Promise.all(
      Array.from({ length: MAX_PARSE_CHILDREN + 1 }, (_, n) =>
        fresh.extractDocumentText(smallBook(), XLSX_MIME, { name: `emfile-${n}.xlsx` }),
      ),
    ),
    "слоты после EMFILE",
  );
  assert.deepEqual(results, Array(MAX_PARSE_CHILDREN + 1).fill(null));
  assert.ok(performance.now() - started < 2000, "слот не освобождён");
  assert.equal(warnLines(log, ISOLATION_FAILED).length, MAX_PARSE_CHILDREN + 1);
  assert.deepEqual(kills, []);
});

// Ошибку, о которой ребёнок сообщил сам (битый файл), родитель пробрасывает как
// раньше, но её текст ограничен: exceljs вшивает в сообщения куски самого файла
test("изоляция: ошибка разбора из ребёнка пробрасывается, а её текст ограничен", async (t) => {
  const dir = tempDir(t);
  const child = writeChild(
    dir,
    `process.once("message", () => process.send({ ok: false, error: "x".repeat(5000) }, () => process.exit(0)));`,
  );

  await assert.rejects(
    extractDocumentText(smallBook(), XLSX_MIME, { _childPath: child, _timeoutMs: 10_000 }),
    (error) => {
      assert.ok(error.message.length <= 300, `сообщение ${error.message.length} знаков`);
      assert.match(error.message, /^x+$/);
      return true;
    },
  );
});

// Не больше двух детей одновременно: остальные ждут в очереди, но все получают ответ
test("изоляция: одновременно работает не больше двух детей, остальные ждут", async (t) => {
  const dir = tempDir(t);
  const trace = path.join(dir, "trace");
  const child = writeChild(
    dir,
    `const fs = require("node:fs");
     fs.appendFileSync(${JSON.stringify(trace)}, "start " + Date.now() + "\\n");
     process.once("message", () => setTimeout(() => {
       fs.appendFileSync(${JSON.stringify(trace)}, "end " + Date.now() + "\\n");
       process.send({ ok: true, text: "готово" }, () => process.exit(0));
     }, 400));`,
  );

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      extractDocumentText(smallBook(), XLSX_MIME, { _childPath: child, _timeoutMs: 10_000 }),
    ),
  );

  assert.deepEqual(results, Array(5).fill("готово"));
  const events = fs
    .readFileSync(trace, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" "));
  assert.equal(events.length, 10);
  // Конец раньше начала на одной и той же миллисекунде: слот освобождается до нового запуска
  events.sort((a, b) => Number(a[1]) - Number(b[1]) || (a[0] === "end" ? -1 : 1));
  let running = 0;
  let peak = 0;
  for (const [kind] of events) {
    running += kind === "start" ? 1 : -1;
    peak = Math.max(peak, running);
  }
  assert.ok(peak <= 2, `одновременно работало ${peak}`);
});

// Что именно получает ребёнок: куча 256 МБ, свои флаги (родительские не наследуются),
// Buffer целиком по advanced-IPC, среда без секретов родителя и нулевой лимит на
// дамп памяти: ребёнок, упавший по нехватке кучи (SIGABRT), не должен оставлять
// core-файл — на хосте с systemd-coredump это ~19 МБ на каждый документ-бомбу, а при
// файловом core_pattern — ~300 МБ в рабочем каталоге. И потолок процессорного
// времени в 60 с (ulimit -t): 4× запаса над настоящими детьми (до 16 с за окно в 15 с)
test("изоляция: ребёнок запускается с кучей 256 МБ, чистой средой, без дампа памяти, с потолком процессора и получает Buffer", async (t) => {
  const dir = tempDir(t);
  const child = writeChild(
    dir,
    `const v8 = require("node:v8");
     const limits = (() => {
       try { return require("node:fs").readFileSync("/proc/self/limits", "utf8"); } catch { return ""; }
     })();
     process.once("message", (message) => process.send({ ok: true, text: JSON.stringify({
       execArgv: process.execArgv,
       heapMb: Math.round(v8.getHeapStatistics().heap_size_limit / 1048576),
       isBuffer: Buffer.isBuffer(message.data),
       bytes: message.data.length,
       mimetype: message.mimetype,
       hasCanary: "D2_SECRET_CANARY" in process.env,
       coreLimit: /Max core file size\\s+(\\S+)/.exec(limits)?.[1] ?? null,
       cpuLimit: /Max cpu time\\s+(\\S+)/.exec(limits)?.[1] ?? null,
     }) }, () => process.exit(0)));`,
  );
  process.env.D2_SECRET_CANARY = "секрет родителя";
  t.after(() => delete process.env.D2_SECRET_CANARY);
  const book = smallBook();

  const info = JSON.parse(
    await extractDocumentText(book, XLSX_MIME, { _childPath: child, _timeoutMs: 10_000 }),
  );

  assert.deepEqual(info.execArgv, ["--max-old-space-size=256"]);
  assert.equal(info.isBuffer, true);
  assert.equal(info.bytes, book.length);
  assert.equal(info.mimetype, XLSX_MIME);
  assert.equal(info.hasCanary, false);
  if (process.platform === "linux") {
    assert.equal(info.coreLimit, "0", "лимит дампа памяти ребёнка");
    // Потолок процессорного времени ставит ядро: он держит и тогда, когда родитель убит
    // SIGKILL и его обработчик выхода не сработал (ребёнок в вечном цикле не уйдёт сам)
    assert.equal(info.cpuLimit, String(PARSE_CHILD_CPU_SECONDS), "лимит процессорного времени ребёнка");
  }
  // Флаг --max-old-space-size=256 ограничивает только старое поколение, а
  // heap_size_limit, который отдаёт V8, прибавляет к нему молодое, и его размер зависит
  // от версии V8. Замер здесь: 304 МБ на Node 22.22.2 и 448 МБ на Node 24.1.0 (боевая
  // среда, node:24-alpine); без флага на этой машине около 4 ГБ. Поэтому границы
  // широкие: проверка ловит «флаг не подействовал», а не размер молодого поколения.
  // Стоит последней — размер, зависящий от версии, не должен прятать за своим отказом
  // остальные проверки изоляции, в том числе потолок процессорного времени выше.
  assert.ok(info.heapMb > 200 && info.heapMb < 700, `куча ${info.heapMb} МБ`);
});

// Дети не переживают бэкенд. Остановка D3 кончается process.exit (аварийный выход тоже),
// а ребёнок узнаёт о смерти родителя лишь тогда, когда его цикл событий дойдёт до
// 'disconnect': разбор PDF, DOCX и XLSX виток почти не отдаёт, а ребёнок в синхронном
// цикле не дождётся его никогда и жжёт ядро, пока жив хост. Родитель здесь — отдельный
// процесс с настоящим модулем, ребёнок — поддельный, в вечном синхронном цикле.
// Родитель выходит посреди «разбора», и ребёнка остаться не должно. Контейнер этого и
// сам не гарантирует (init: true только в проде; dev и запуск без контейнера — нет).
test("дети разбора не переживают родителя: выход бэкенда посреди разбора добивает ребёнка", { skip: process.platform === "win32" }, async (t) => {
  const dir = tempDir(t);
  const pidFile = path.join(dir, "pid");
  const spinning = path.join(dir, "spinning");
  const child = writeChild(
    dir,
    `const fs = require("node:fs");
     fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
     process.on("disconnect", () => process.exit(1));
     process.once("message", () => {
       fs.writeFileSync(${JSON.stringify(spinning)}, "x");
       for (;;) {}
     });`,
  );
  const parentScript = `
    require("module-alias/register");
    const fs = require("node:fs");
    const { extractDocumentText } = require(${JSON.stringify(path.join(__dirname, "attachmentExtractor.js"))});
    extractDocumentText(Buffer.from("%PDF-1.4"), "application/pdf", {
      _childPath: ${JSON.stringify(child)},
      _timeoutMs: 120000,
    }).catch(() => {});
    // Ребёнок получил документ и ушёл в цикл: выходим явно, как остановка D3
    const poll = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(spinning)})) {
        clearInterval(poll);
        process.exit(0);
      }
    }, 20);
  `;
  // Чужой процесс не трогаем: перед чисткой сверяем командную строку по pid
  t.after(() => {
    try {
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      if (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(child)) process.kill(pid, "SIGKILL");
    } catch {
      // файла pid нет, процесса нет или /proc нет — чистить нечего
    }
  });

  // timeout и добивание в t.after: застрявший родитель не должен пережить тест
  const parent = childProcess.spawn(process.execPath, ["-e", parentScript], {
    cwd: path.join(__dirname, ".."),
    stdio: "ignore",
    timeout: 30_000,
  });
  t.after(() => parent.kill("SIGKILL"));
  const exit = await within(
    30_000,
    new Promise((resolve, reject) => {
      parent.once("error", reject);
      parent.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    "родитель",
  );
  assert.deepEqual(exit, { code: 0, signal: null });

  // SIGKILL уходит из обработчика 'exit' синхронно; ждём, пока ядро добьёт процесс
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  const deadline = performance.now() + 5000;
  while (isRunning(pid) && performance.now() < deadline) await sleep(25);
  assert.equal(isRunning(pid), false, "ребёнок пережил родителя");
});

// При нехватке памяти ядро (OOM killer) должно убить разбор, а не бэкенд: ребёнок на
// старте поднимает свой oom_score_adj до 1000 («убей меня первым»). Свой счёт поднять
// может любой процесс без привилегий. Модуль подключает и сам бэкенд (константы,
// parseDocumentText), поэтому счёт ставится только в самом ребёнке, а не при загрузке.
test("ребёнок просит ядро убить его первым: oom_score_adj = 1000, и отвечает как прежде", { skip: process.platform !== "linux" }, async (t) => {
  const child = childProcess.fork(path.join(__dirname, "documentTextChild.js"), [], {
    execArgv: ["--max-old-space-size=256"],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {},
  });
  t.after(() => child.kill("SIGKILL"));
  const score = () => fs.readFileSync(`/proc/${child.pid}/oom_score_adj`, "utf8").trim();

  // Запись идёт на старте, до первого сообщения: ждём, пока ребёнок до неё дойдёт
  const deadline = performance.now() + 10_000;
  while (score() !== "1000" && performance.now() < deadline) await sleep(25);
  assert.equal(score(), "1000");

  const reply = await within(
    20_000,
    new Promise((resolve, reject) => {
      child.once("message", resolve);
      child.once("error", reject);
      child.send({ data: Buffer.from("привет"), mimetype: "text/plain" });
    }),
    "ответ ребёнка",
  );
  assert.deepEqual(reply, { ok: true, text: "привет" });
});

// Запись oom_score_adj в ребёнке обёрнута в try/catch: вне Linux файла нет (macOS и
// Windows — машины разработки), а где /proc есть, запись может быть закрыта (EACCES
// в контейнере с урезанными правами). Разбор от неё зависеть не должен: без try/catch
// ребёнок падал бы до первого сообщения и не отвечал бы никогда. На Linux запись
// удаётся, и этот путь сам не проходится, поэтому её ломает хук: он грузится в ребёнка
// через --require раньше его кода и бросает на пути oom_score_adj, оставляя метку.
test("ребёнок отвечает как прежде, когда запись oom_score_adj не удалась", async (t) => {
  const dir = tempDir(t);
  const marker = path.join(dir, "write-failed");
  const hook = writeChild(
    dir,
    `const fs = require("node:fs");
     const write = fs.writeFileSync;
     fs.writeFileSync = function (target, ...rest) {
       if (String(target).endsWith("oom_score_adj")) {
         write.call(fs, ${JSON.stringify(marker)}, String(target));
         throw Object.assign(new Error("EACCES: permission denied, open '" + target + "'"), { code: "EACCES" });
       }
       return write.call(this, target, ...rest);
     };`,
    "break-oom-write.js",
  );

  const { messages, code, signal } = await askChild(Buffer.from("привет"), "text/plain", [
    "--require",
    hook,
  ]);

  // Хук сработал (иначе тест ничего бы не проверял), а ребёнок ответил и вышел сам
  assert.ok(fs.existsSync(marker), "запись oom_score_adj хуком не сломана");
  assert.deepEqual(messages, [{ ok: true, text: "привет" }]);
  assert.equal(code, 0);
  assert.equal(signal, null);
});

test("oom_score_adj: модуль, подключённый бэкендом, счёт самого процесса не трогает", { skip: process.platform !== "linux" }, () => {
  // Этот процесс загрузил и attachmentExtractor, и documentTextChild в начале файла,
  // ровно как бэкенд: счёт у него остался прежним
  assert.equal(readOomScore(), OOM_SCORE_BEFORE_LOAD, "загрузка модуля изменила oom_score_adj процесса");
});

// Быстрые проверки идут до запуска: огромный файл и чужой тип не порождают процесс
test("изоляция: слишком большой файл и чужой тип отсекаются до запуска ребёнка", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const never = { _childPath: path.join(os.tmpdir(), "d2-нет-такого-ребёнка.js") };

  for (const mimetype of [XLSX_MIME, DOCX_MIME, PDF_MIME, "text/plain"]) {
    await assert.rejects(
      extractDocumentText(Buffer.alloc(MAX_DOC_BYTES + 1), mimetype, never),
      { code: "ERR_DOCUMENT_TOO_LARGE" },
      mimetype,
    );
  }
  assert.equal(await extractDocumentText(Buffer.from("PK"), "application/zip", never), null);
  assert.equal(warnLines(log, ISOLATION_FAILED).length, 0, "ребёнок не запускался");
});

// ── Ошибки в логе ограничены ───────────────────────────────────────────────
// exceljs вшивает в сообщение об ошибке кусок файла: 11 КБ архива с атрибутом на
// 10 МиБ давали строку лога в 10 485 851 знак
test("лог: текст ошибки разбора не длиннее 300 знаков", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const packageRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Foo x="${"A".repeat(10 * 1024 * 1024)}"/></Relationships>`;
  const bomb = handmadeXlsx(inlineRow(1, "начало"), { packageRels });
  assert.ok(bomb.length < 64 * 1024, `файл ${bomb.length} байт`);

  await assert.rejects(extractDocumentText(bomb, XLSX_MIME), (error) => {
    assert.ok(error.message.length <= 300, `сообщение ${error.message.length} знаков`);
    assert.match(error.message, /Unexpected xml node/);
    return true;
  });

  t.mock.method(storage, "getObjectBuffer", async () => bomb);
  const result = await extractAttachments([attachment(XLSX_MIME)]);
  assert.deepEqual(result, { images: [], documents: [] });
  const failures = warnLines(log, "AI guide: failed to read attachment");
  assert.equal(failures.length, 1);
  assert.ok(failures[0].arguments[2].error.length <= 300, `в логе ${failures[0].arguments[2].error.length} знаков`);
});

// Любое сообщение об ошибке из этого модуля — в лог не длиннее 300 знаков, не только
// разбор: ошибки хранилища (S3 присылает длинные) идут по тому же пути
test("лог: сообщение об ошибке хранилища тоже не длиннее 300 знаков", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  t.mock.method(storage, "getObjectBuffer", async () => {
    throw new Error("s".repeat(10_000));
  });

  const result = await extractAttachments([attachment(XLSX_MIME)]);

  assert.deepEqual(result, { images: [], documents: [] });
  const failures = warnLines(log, "AI guide: failed to read attachment");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].arguments[2].error.length, 300);
});

// ── Размер документа ───────────────────────────────────────────────────────

test("документ больше 10 МБ не разбирается", async (t) => {
  t.mock.method(storage, "getObjectBuffer", async () =>
    Buffer.alloc(MAX_DOC_BYTES + 1, "a"),
  );

  const result = await extractAttachments([
    { name: "huge.txt", originalName: "Лог.txt", mimetype: "text/plain" },
  ]);

  assert.deepEqual(result, { images: [], documents: [] });
});

test("документ в пределах 10 МБ читается как прежде", async (t) => {
  t.mock.method(storage, "getObjectBuffer", async () =>
    Buffer.from("Не печатает принтер в бухгалтерии", "utf8"),
  );

  const result = await extractAttachments([
    { name: "note.txt", originalName: "Заметка.txt", mimetype: "text/plain" },
  ]);

  assert.deepEqual(result.documents, [
    { name: "Заметка.txt", text: "Не печатает принтер в бухгалтерии" },
  ]);
});

// ── Число документов за вызов ──────────────────────────────────────────────
// Каждый враждебный документ стоит до 15 секунд ребёнка, а вложений в заявке может быть
// десятки: без потолка гайд одной заявки занимал бы бэкенд минутами. Читаются первые 10
// документов в порядке списка, остальные пропускаются не скачанными, одной строкой в лог.
// Картинки и неизвестные типы документами не считаются.
const textDocument = (n) => ({
  name: `note-${n}.txt`,
  originalName: `Заметка ${n}`,
  mimetype: "text/plain",
});

test("extractAttachments: 12 документов — читаются 10 первых, 2 пропущены, одна строка в логе", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const fetched = [];
  t.mock.method(storage, "getObjectBuffer", async (name) => {
    fetched.push(name);
    return Buffer.from(`текст ${name}`, "utf8");
  });
  const documents = Array.from({ length: 12 }, (_, n) => textDocument(n + 1));
  // Картинка и аудио вперемешку с документами: в счёт документов они не идут
  const png = { name: "shot.png", originalName: "Снимок", mimetype: "image/png" };
  const audio = { name: "call.mp3", originalName: "Звонок", mimetype: "audio/mpeg" };

  const result = await extractAttachments([png, ...documents.slice(0, 6), audio, ...documents.slice(6)]);

  assert.equal(result.images.length, 1);
  assert.deepEqual(
    result.documents,
    documents.slice(0, 10).map((doc) => ({ name: doc.originalName, text: `текст ${doc.name}` })),
  );
  // Пропущенные не скачивались: порядок и состав скачанного — картинка и первые 10
  assert.deepEqual(fetched, ["shot.png", ...documents.slice(0, 10).map((doc) => doc.name)]);
  const lines = warnLines(log, TOO_MANY_DOCUMENTS);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].arguments[2], { limit: MAX_DOCUMENTS_PER_GUIDE, skipped: 2 });
});

test("extractAttachments: потолок документов — граница: 10 без строки в логе, 11 — один пропущенный", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  t.mock.method(storage, "getObjectBuffer", async (name) => Buffer.from(`текст ${name}`, "utf8"));

  const ten = await extractAttachments(Array.from({ length: 10 }, (_, n) => textDocument(n + 1)));
  assert.equal(ten.documents.length, 10);
  assert.equal(warnLines(log, TOO_MANY_DOCUMENTS).length, 0);

  const eleven = await extractAttachments(Array.from({ length: 11 }, (_, n) => textDocument(n + 1)));
  assert.equal(eleven.documents.length, 10);
  const lines = warnLines(log, TOO_MANY_DOCUMENTS);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].arguments[2].skipped, 1);
});

// ── Размер и число записей zip ─────────────────────────────────────────────
// 10 МБ потолка считают сжатые байты, а xlsx/docx — zip: нули сжимаются ~1000:1.
// Заявленные размер после распаковки и число записей читаются из каталога архива,
// ничего не распаковывая. Это быстрые отказы до запуска ребёнка: очевидные бомбы
// пропускаются без процесса, остальное ловит изоляция.

// ИИ берёт из документа не больше 8000 знаков, поэтому книга, заявляющая больше
// 16 МиБ содержимого, полной загрузки не стоит. В настоящих файлах записей десятки
// (у docx 7–19, у xlsx 15 и по одной на лист), так что 2000 — с большим запасом.
test("потолки: 10 МБ сжатых байт, 16 МиБ после распаковки и 2000 записей в zip", () => {
  assert.equal(MAX_DOC_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_INFLATED_BYTES, 16 * 1024 * 1024);
  assert.equal(MAX_ZIP_ENTRIES, 2000);
});

test("declaredZipSize: число записей и сумма заявленных размеров из каталога архива", () => {
  const zip = zipOf([
    { name: "a.xml", data: "x".repeat(1000) },
    { name: "b.xml", data: "y".repeat(234) },
  ]);
  assert.deepEqual(declaredZipSize(zip), { entries: 2, bytes: 1234 });

  // Комментарий к архиву сдвигает конец каталога от конца файла
  const commented = zipOf([{ name: "a.xml", data: "x".repeat(1000) }], "комментарий".repeat(50));
  assert.deepEqual(declaredZipSize(commented), { entries: 1, bytes: 1000 });

  // zip64: размер 0xFFFFFFFF в каталоге — «очень большой», а не четыре гигабайта
  const zip64 = zipOf([{ name: "big.bin", data: "z", declaredSize: 0xffffffff }]);
  assert.ok(declaredZipSize(zip64).bytes > MAX_INFLATED_BYTES);
});

test("declaredZipSize: не zip и битый каталог — ошибка, а не ноль", () => {
  const zip = zipOf([{ name: "a.xml", data: "x".repeat(1000) }]);

  const pastTheEnd = Buffer.from(zip); // каталог «начинается» за концом файла
  pastTheEnd.writeUInt32LE(pastTheEnd.length, pastTheEnd.length - 22 + 16);

  const brokenEntry = Buffer.from(zip); // подпись записи каталога испорчена
  brokenEntry.writeUInt32LE(0, brokenEntry.readUInt32LE(brokenEntry.length - 22 + 16));

  for (const bad of [
    Buffer.from("это не архив, а обычный текст длиннее двадцати двух байт"),
    Buffer.alloc(0),
    zip.subarray(0, zip.length - 10),
    pastTheEnd,
    brokenEntry,
  ]) {
    assert.throws(() => declaredZipSize(bad), /zip/);
  }
});

test("xlsx: книга, раздувающаяся при распаковке больше 16 МиБ, пропускается", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const rows = inlineRow(1, "безобидная таблица");
  const bomb = handmadeXlsx(rows, { extraEntries: [zerosEntry("xl/media/image1.png")] });
  assert.ok(bomb.length < 1024 * 1024, `в архиве ${bomb.length} байт — под потолком 10 МБ`);

  // Без вложения та же книга читается — значит, отказ именно из-за размера
  assert.equal(await extractDocumentText(handmadeXlsx(rows), XLSX_MIME), "# Лист\nбезобидная таблица");
  await assert.rejects(extractDocumentText(bomb, XLSX_MIME), { code: "ERR_INFLATED_TOO_LARGE" });

  t.mock.method(storage, "getObjectBuffer", async () => bomb);
  const result = await extractAttachments([attachment(XLSX_MIME)]);

  assert.deepEqual(result, { images: [], documents: [] });
  const skipped = warnLines(log, "AI guide: skipping oversized document");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].arguments[2].reason, "ERR_INFLATED_TOO_LARGE");
  assert.ok(skipped[0].arguments[2].inflatedBytes > MAX_INFLATED_BYTES);
});

test("docx: тот же потолок распаковки", async (t) => {
  t.mock.method(logger, "log", () => {});
  const bomb = handmadeDocx([zerosEntry("word/media/image1.png")]);

  assert.equal((await extractDocumentText(handmadeDocx(), DOCX_MIME)).trim(), "Не работает принтер");
  await assert.rejects(extractDocumentText(bomb, DOCX_MIME), { code: "ERR_INFLATED_TOO_LARGE" });

  t.mock.method(storage, "getObjectBuffer", async () => bomb);
  const result = await extractAttachments([attachment(DOCX_MIME)]);

  assert.deepEqual(result, { images: [], documents: [] });
});

// Каталог с подделанным размером: читать его надо без распаковки, поэтому тело
// записи может быть пустяковым. Ровно потолок проходит проверку (дальше падает уже
// сам zip-разбор — размер не сходится), на байт больше — отказ проверки.
test("проверка распаковки: ровно 16 МиБ проходит, на байт больше — отказ", async () => {
  const declaring = (declaredSize) =>
    zipOf([{ name: "xl/worksheets/sheet1.xml", data: "x", declaredSize }]);

  await assert.rejects(extractDocumentText(declaring(MAX_INFLATED_BYTES), XLSX_MIME), (error) => {
    assert.notEqual(error.code, "ERR_INFLATED_TOO_LARGE");
    return true;
  });
  await assert.rejects(extractDocumentText(declaring(MAX_INFLATED_BYTES + 1), XLSX_MIME), {
    code: "ERR_INFLATED_TOO_LARGE",
  });
});

// Число записей заявляет каталог архива. Честная книга ровно на потолке читается
// (exceljs пропускает записи-наполнитель), на одну запись больше — отказ до разбора.
test("проверка записей: ровно 2000 проходит, на одну больше — отказ", async () => {
  const rows = inlineRow(1, "начало");
  // [Content_Types].xml, _rels/.rels, workbook.xml, его rels и один лист; у docx — три
  const XLSX_BASE = 5;
  const DOCX_BASE = 3;

  const atCap = handmadeXlsx(rows, { extraEntries: paddingEntries(MAX_ZIP_ENTRIES - XLSX_BASE) });
  assert.equal(declaredZipSize(atCap).entries, MAX_ZIP_ENTRIES);
  assert.equal(await extractDocumentText(atCap, XLSX_MIME), "# Лист\nначало");

  const overCap = handmadeXlsx(rows, { extraEntries: paddingEntries(MAX_ZIP_ENTRIES - XLSX_BASE + 1) });
  await assert.rejects(extractDocumentText(overCap, XLSX_MIME), {
    code: "ERR_TOO_MANY_ZIP_ENTRIES",
  });

  // Тот же потолок у docx
  const docxAtCap = handmadeDocx(paddingEntries(MAX_ZIP_ENTRIES - DOCX_BASE));
  assert.equal((await extractDocumentText(docxAtCap, DOCX_MIME)).trim(), "Не работает принтер");
  const docxOverCap = handmadeDocx(paddingEntries(MAX_ZIP_ENTRIES - DOCX_BASE + 1));
  await assert.rejects(extractDocumentText(docxOverCap, DOCX_MIME), {
    code: "ERR_TOO_MANY_ZIP_ENTRIES",
  });
});

// Форма из ревью: тысячи пустых листов. Ни 10 МБ сжатых байт, ни 16 МиБ после
// распаковки её не видят (36 000 листов — это 9 МиБ в zip и 12 МиБ заявленных), а
// exceljs платит за каждую часть архива: те 36 000 листов читались 61 с. В тесте
// 3000 листов: без проверки чтение занимает ~1 с, а не минуту, так что регресс
// роняет тест, а не вешает прогон.
test("xlsx: книга из 3000 пустых листов пропускается за миллисекунды", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const book = manySheetsXlsx(3000);
  const { entries, bytes } = declaredZipSize(book);
  assert.ok(book.length < MAX_DOC_BYTES, "в архиве меньше 10 МБ");
  assert.ok(bytes < MAX_INFLATED_BYTES, "заявлено меньше 16 МиБ");
  assert.ok(entries > MAX_ZIP_ENTRIES, `записей ${entries}`);

  const started = performance.now();
  await assert.rejects(extractDocumentText(book, XLSX_MIME), { code: "ERR_TOO_MANY_ZIP_ENTRIES" });
  const ms = performance.now() - started;
  assert.ok(ms < 200, `${ms.toFixed(0)} мс`);

  t.mock.method(storage, "getObjectBuffer", async () => book);
  const result = await extractAttachments([attachment(XLSX_MIME)]);

  assert.deepEqual(result, { images: [], documents: [] });
  const skipped = warnLines(log, "AI guide: skipping oversized document");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].arguments[2].reason, "ERR_TOO_MANY_ZIP_ENTRIES");
  assert.equal(skipped[0].arguments[2].entries, entries);
});

test("xlsx: обычная книга проходит проверки размера и числа записей", async (t) => {
  const buffer = await workbookBuffer();
  const { entries, bytes } = declaredZipSize(buffer);
  assert.ok(bytes < MAX_INFLATED_BYTES / 100, `заявлено ${bytes} байт`);
  assert.ok(entries < MAX_ZIP_ENTRIES / 10, `записей ${entries}`);
  t.mock.method(storage, "getObjectBuffer", async () => buffer);

  const result = await extractAttachments([attachment(XLSX_MIME)]);

  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].name, "Выгрузка");
  assert.ok(result.documents[0].text.startsWith("# Серверы\nИмя,Роль,Заметка\n"));
});

test("не zip под видом xlsx или docx: файл пропускается, extractAttachments не бросает", async (t) => {
  const log = t.mock.method(logger, "log", () => {});
  const whole = await workbookBuffer();
  const pastTheEnd = Buffer.from(whole); // каталог «начинается» за концом файла
  pastTheEnd.writeUInt32LE(pastTheEnd.length, pastTheEnd.length - 22 + 16);
  const broken = [
    Buffer.from("а это обычный текст, а не архив"),
    Buffer.alloc(0),
    whole.subarray(0, Math.floor(whole.length / 2)),
    pastTheEnd,
  ];

  let served;
  t.mock.method(storage, "getObjectBuffer", async () => served);
  for (const buffer of broken) {
    served = buffer;
    for (const mimetype of [XLSX_MIME, DOCX_MIME]) {
      const result = await extractAttachments([attachment(mimetype)]);
      assert.deepEqual(result, { images: [], documents: [] });
    }
  }

  const failures = warnLines(log, "AI guide: failed to read attachment");
  assert.equal(failures.length, broken.length * 2);
});
