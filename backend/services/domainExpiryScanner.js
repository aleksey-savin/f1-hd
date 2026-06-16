// Парсер таблиц доменов/хостинга из markdown-контента заметок (без ИИ).
// Находит таблицы со столбцами «домен» и «дата продления»; порядок столбцов
// произвольный — определяем по заголовкам и по содержимому ячеек. Структура
// сервиса повторяет services/secretsScanner.js.

// Домено-подобная строка: bsb.ru, syndicate-portcafe.online и т. п.
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+$/i;

// Ключевые слова заголовков столбцов
const DATE_HEADER_RE = /продл|действ|оплач|срок|дата|expir|valid|renew|\bдо\b/i;
const REGISTRAR_HEADER_RE = /регистр|хостер|host|provider/i;
const DOMAIN_HEADER_RE = /домен|наимен|сайт|адрес|name|url|site/i;

const SEPARATOR_RE = /^\s*\|?[\s:|-]+\|?\s*$/;
const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;

// Собирает Date (UTC-полночь) из чисел, отсеивая некорректные/переполняющиеся
// даты (31.02 …). UTC — чтобы сохранённая дата не «съезжала» от часового пояса.
const buildDate = (y, m, d) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
};

// Разбирает дату DD.MM.YYYY (рус.) / DD/MM/YYYY / YYYY-MM-DD → Date | null
const parseDate = (value) => {
  const str = String(value || "").trim();

  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dmy = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) {
    return buildDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }

  return null;
};

// Разбивает строку таблицы на ячейки (снимаем крайние палки, тримим)
const splitCells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

// Извлекает markdown-таблицы из контента → [{ header: string[], rows: string[][] }]
const extractTables = (content) => {
  if (!content || typeof content !== "string") {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const tables = [];
  let block = [];

  const flush = () => {
    if (block.length >= 2) {
      // Отбрасываем строки-разделители (| --- | --- |); первая оставшаяся — заголовок
      const dataLines = block.filter((line) => !SEPARATOR_RE.test(line));
      if (dataLines.length >= 2) {
        tables.push({
          header: splitCells(dataLines[0]),
          rows: dataLines.slice(1).map(splitCells),
        });
      }
    }
    block = [];
  };

  for (const line of lines) {
    if (TABLE_LINE_RE.test(line)) {
      block.push(line);
    } else {
      flush();
    }
  }
  flush();

  return tables;
};

// Доля ячеек столбца, удовлетворяющих предикату
const columnMatchRatio = (rows, colIndex, predicate) => {
  if (!rows.length) {
    return 0;
  }
  let count = 0;
  for (const row of rows) {
    if (predicate(row[colIndex])) {
      count += 1;
    }
  }
  return count / rows.length;
};

const isDateCell = (cell) => parseDate(cell) !== null;
const isDomainCell = (cell) => DOMAIN_RE.test(String(cell || "").trim());

// Парсит таблицы доменов из контента заметки → [{ domain, registrar, expiresAt }].
// Таблица считается доменной только при наличии и столбца даты, и столбца домена.
const parseDomainTables = (content) => {
  const tables = extractTables(content);
  const entries = [];
  const seen = new Set();

  for (const { header, rows } of tables) {
    const colCount = header.length;

    // Столбец даты: по заголовку или по содержимому (≥ половины ячеек — даты)
    let dateCol = header.findIndex((h) => DATE_HEADER_RE.test(h));
    if (dateCol === -1) {
      for (let i = 0; i < colCount; i += 1) {
        if (columnMatchRatio(rows, i, isDateCell) >= 0.5) {
          dateCol = i;
          break;
        }
      }
    }

    // Столбец регистратора: по заголовку (его ячейки тоже домено-подобны,
    // поэтому отличаем именно по заголовку)
    const registrarCol = header.findIndex((h) => REGISTRAR_HEADER_RE.test(h));

    // Столбец домена: по заголовку, иначе первый домено-подобный, не совпадающий
    // со столбцом даты/регистратора
    let domainCol = header.findIndex((h) => DOMAIN_HEADER_RE.test(h));
    if (domainCol === -1 || domainCol === dateCol || domainCol === registrarCol) {
      domainCol = -1;
      for (let i = 0; i < colCount; i += 1) {
        if (i === dateCol || i === registrarCol) {
          continue;
        }
        if (columnMatchRatio(rows, i, isDomainCell) >= 0.5) {
          domainCol = i;
          break;
        }
      }
    }

    if (dateCol === -1 || domainCol === -1) {
      continue;
    }

    for (const row of rows) {
      const domain = String(row[domainCol] || "").trim();
      const expiresAt = parseDate(row[dateCol]);
      if (!domain || !expiresAt) {
        continue;
      }
      const key = domain.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        domain,
        registrar:
          registrarCol !== -1 ? String(row[registrarCol] || "").trim() : "",
        expiresAt,
      });
    }
  }

  return entries;
};

module.exports = { parseDomainTables, parseDate, extractTables };
