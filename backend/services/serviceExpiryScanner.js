// Парсер таблиц услуг (домены, хостинг и т. п.) из markdown-контента заметок
// (без ИИ). Находит таблицы со столбцами «услуга» и «дата продления»; порядок
// столбцов произвольный — определяем по заголовкам и по содержимому ячеек.
// Структура сервиса повторяет services/secretsScanner.js.

// Значение услуги обычно выглядит как домен: bsb.ru, syndicate-portcafe.online
// и т. п. — этим же шаблоном находим столбец услуги по содержимому.
const SERVICE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+$/i;

// Ключевые слова заголовков столбцов
const DATE_HEADER_RE = /продл|действ|оплач|срок|дата|expir|valid|renew|\bдо\b/i;
const REGISTRAR_HEADER_RE = /регистр|хостер|host|provider/i;
const SERVICE_HEADER_RE =
  /услуг|сервис|service|домен|наимен|сайт|адрес|name|url|site/i;

// «Владелец услуги» (юрлицо, организация, подписант…) — запасной признак столбца
// услуги для таблиц, где значение — не домен и заголовок не «услуга/наименование»
// (напр. электронные подписи, привязанные к юрлицам). Применяется ТОЛЬКО когда ни
// SERVICE_HEADER_RE, ни домено-подобное содержимое не дали столбца, — чтобы в
// таблице доменов услугой оставался домен, а не компания-владелец.
const SERVICE_OWNER_HEADER_RE =
  /юр\.?\s*лиц|организац|компан|владел|подписант|контрагент/i;

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
const isServiceCell = (cell) => SERVICE_RE.test(String(cell || "").trim());

// Парсит таблицы услуг из контента заметки → [{ service, registrar, expiresAt }].
// Таблица считается таблицей услуг только при наличии и столбца даты, и столбца услуги.
const parseServiceTables = (content) => {
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

    // Столбец регистратора/провайдера: по заголовку (его ячейки тоже домено-подобны,
    // поэтому отличаем именно по заголовку)
    const registrarCol = header.findIndex((h) => REGISTRAR_HEADER_RE.test(h));

    // Столбец услуги: сначала по «сильному» заголовку (услуга/домен/сайт…), иначе
    // первый домено-подобный столбец, не совпадающий со столбцом даты/регистратора,
    // и лишь в последнюю очередь — по заголовку «владельца услуги» (юрлицо/компания…)
    let serviceCol = header.findIndex((h) => SERVICE_HEADER_RE.test(h));
    if (
      serviceCol === -1 ||
      serviceCol === dateCol ||
      serviceCol === registrarCol
    ) {
      serviceCol = -1;
      for (let i = 0; i < colCount; i += 1) {
        if (i === dateCol || i === registrarCol) {
          continue;
        }
        if (columnMatchRatio(rows, i, isServiceCell) >= 0.5) {
          serviceCol = i;
          break;
        }
      }
    }
    if (serviceCol === -1) {
      const ownerCol = header.findIndex((h) => SERVICE_OWNER_HEADER_RE.test(h));
      if (ownerCol !== -1 && ownerCol !== dateCol && ownerCol !== registrarCol) {
        serviceCol = ownerCol;
      }
    }

    if (dateCol === -1 || serviceCol === -1) {
      continue;
    }

    for (const row of rows) {
      const service = String(row[serviceCol] || "").trim();
      const expiresAt = parseDate(row[dateCol]);
      if (!service || !expiresAt) {
        continue;
      }
      const key = service.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        service,
        registrar:
          registrarCol !== -1 ? String(row[registrarCol] || "").trim() : "",
        expiresAt,
      });
    }
  }

  return entries;
};

module.exports = { parseServiceTables, parseDate, extractTables };
