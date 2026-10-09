/**
 * Входящее письмо: что разборщик (middleware/emailHandling) берёт из
 * заголовков помимо темы и тела, и как по этому ищет.
 *
 * Отправитель — адрес из заголовка From, но только тот, что в нём и написан.
 * Принимающий сервер проверяет отправителя (SPF/DKIM/DMARC) по заголовку как
 * есть, а mailparser разворачивает закодированные слова (RFC 2047), по-своему
 * читает пробелы, скобки и кавычки и из нескольких From берёт последний: адрес,
 * которого сервер не видел, открыл бы подмену даже для домена с политикой
 * reject. Поэтому senderAddress называет отправителя, только когда выполнено
 * всё:
 *   - строка From в письме одна (mail.headerLines), не длиннее 4096 знаков,
 *     начинается с «From:» и не содержит управляющих знаков;
 *   - ящик один (при нескольких RFC 5322, п. 3.6.2, требует заголовок Sender, а
 *     проверен мог быть любой из ящиков);
 *   - адрес написан в этой строке открытым текстом и целиком — не в
 *     закодированном слове, не в кавычках, не в комментарии — и другого адреса
 *     в ней нет; угловые скобки — одна пара вокруг адреса либо их нет;
 *   - адрес не длиннее 254 знаков.
 * Иначе отправитель неизвестен: "". Текст заголовка не берётся никогда: в нём
 * отображаемое имя, а его пишет кто угодно («"boss@client.ru" <x@evil.com>»
 * опознавался как boss@client.ru — первое похожее на адрес в строке).
 * Законное письмо с редкой записью From (весь заголовок одним закодированным
 * словом, адрес в кавычках, два From) тоже остаётся без отправителя: оно
 * обрабатывается как письмо от неизвестного.
 *
 * Для показа (Ticket.realSender) senderLine отдаёт «Имя <адрес>» или голый
 * адрес и пуста, если фронт прочёл бы из строки другой домен, чем у адреса.
 */

const { domainToUnicode } = require("node:url");

// Пределы на то, что пишет отправитель: законное письмо укладывается в них с
// запасом
const MAX_FROM_LINE = 4096; // строка заголовка From целиком; держит разбор быстрым
const MAX_ADDRESS = 254; // RFC 5321, п. 4.5.3.1.3
const MAX_NAME = 200; // отображаемое имя
const MAX_DOMAIN = 253; // RFC 1035, п. 2.3.4
const MAX_MESSAGE_ID = 998; // RFC 5322, п. 2.1.1: длина строки заголовка

// Как адрес из строки достаёт фронт (frontend/src/util/mail-sender.js, ADDRESS_RE)
const SHOWN_ADDRESS_RE = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/;

// Пробельные знаки заголовка — только пробел и табуляция (RFC 5322, п. 3.2.2).
// JS-шное \s шире («\v», «\f», неразрывный пробел…): mailparser с его trim() читает
// такой знак как пробел, а строгий сервер — как часть слова, и «boss@client.ru» с
// ним на конце для сервера другой адрес. Поэтому слова ниже делятся только по
// [ \t] и знакам-разделителям

// Закодированные слова RFC 2047 подряд. Снимаются только «чистые» слова:
// кодировка как у mailparser, внутри нет пробела, «?», «@», скобок, кавычек, «\»,
// «,», «;», «:» — их снятие не меняет разбор заголовка; и только отдельные слова:
// RFC 2047, п. 5, велит отделять слово пробелом (допустимы и «<», «>», «,», «;»,
// «:»). Слово вплотную к другому тексту строгий сервер читает частью этого текста,
// а mailparser разворачивает и его: оно не снимается, и оставшееся «=?» делает
// заголовок недоверенным (см. writtenAddress)
const ENCODED_WORDS_RE =
  /(?<![^ \t<>,;:])(?:=\?[\w*-]+\?[bq]\?[^?\s@<>"(),;:\\]*\?=)+(?![^ \t<>,;:])/gi;

// Слова текста: между пробелами и «<», «>», «,», «;», «:»
const WORD_SPLIT_RE = /[ \t<>,;:]+/;

// Адрес как слово целиком: «локальная часть@домен», обе части не пусты, «@» одна
const ADDRESS_WORD_RE = /^[^@]+@[^@]+$/;

// Строка заголовка From: начинается с имени поля (пробел или табуляция перед
// двоеточием допустимы, RFC 5322, п. 4.5.4). Сервер читает строку, начатую с
// пробела, как продолжение предыдущей или как начало тела, а mailsplit — как заголовок
const FROM_FIELD_RE = /^from[ \t]*:/i;

// Строка, которую сервер мог бы счесть полем From, хотя mailsplit дал ей другой
// ключ (знак «\0» или пробельный знак в имени поля): второй From письмо портит
const FROM_LIKE_RE = /^[\s\0]*from[\s\0]*:/i;

// Складка заголовка: «\r\n» и пробел или табуляция. Одиночные «\r» и «\n» и прочие
// управляющие знаки в строке — разные серверы делят и обрезают их по-разному
const FOLD_RE = /\r\n(?=[ \t])/g;
const CONTROL_RE = /[\u0000-\u0008\u000a-\u001f\u007f]/;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Делает ли нижний регистр из не-ASCII знака ASCII-знак: у знака Кельвина
 * (U+212A) он обычная «k». Адрес с таким знаком в нижнем регистре назвал бы
 * другой домен, чем написан в заголовке.
 * @param {string} text
 * @returns {boolean}
 */
const lowersToAscii = (text) => {
  for (const char of text) {
    if (char.charCodeAt(0) > 127 && char.toLowerCase().charCodeAt(0) < 128) {
      return true;
    }
  }
  return false;
};

/**
 * Вид адреса для сравнения: нижний регистр, а домен, начинающийся с xn--, —
 * юникодом (так его отдаёт mailparser, а в заголовке он написан как punycode).
 * Только для чистого ASCII-домена: domainToUnicode заодно приводит юникод к
 * «нормальному» виду (полноширинные буквы становятся обычными), и два разных
 * домена сравнялись бы. Домен, который не переводится (domainToUnicode
 * отдаёт ""), остаётся как написан.
 * @param {string} address
 * @returns {string}
 */
const comparable = (address) => {
  const at = address.lastIndexOf("@");
  let domain = address.slice(at + 1).toLowerCase();
  if (/^[\u0000-\u007f]*$/.test(domain) && /(?:^|\.)xn--/.test(domain)) {
    domain = domainToUnicode(domain) || domain;
  }
  return `${address.slice(0, at + 1).toLowerCase()}${domain}`;
};

/**
 * Текст заголовка без строк в кавычках и без комментариев (вложенных тоже,
 * RFC 5322, п. 3.2.2): каждая такая часть заменена пробелом. Разбор слева
 * направо, как у почтового сервера: в комментарии кавычки — обычные знаки, в
 * кавычках — скобки. null — кавычка или скобка не закрыта либо «)» лишняя:
 * такой заголовок разобрать нельзя, и доверять ему тоже.
 * @param {string} text
 * @returns {string|null}
 */
const withoutQuotesAndComments = (text) => {
  let clear = "";
  let depth = 0; // вложенность комментария
  let quoted = false; // внутри строки в кавычках
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (depth === 0 && !quoted) {
      if (char === '"') quoted = true;
      else if (char === "(") depth = 1;
      else if (char === ")") return null;
      else clear += char;
    } else if (char === "\\") {
      i += 1; // экранированный знак на разбор не влияет
    } else if (quoted) {
      if (char === '"') {
        quoted = false;
        clear += " ";
      }
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) clear += " ";
    }
  }
  return depth === 0 && !quoted ? clear : null;
};

/**
 * Адрес, написанный в строке заголовка From открытым текстом и целиком. "" — его
 * нет: адрес только в кавычках, в комментарии или в закодированном слове (RFC 2047,
 * п. 5: в адресе их быть не должно) сервер в заголовке не видит, хотя mailparser
 * разворачивает слово и достаёт адрес из него. "" и когда заголовок разобрать
 * нельзя (кавычка, скобка или угловая скобка без пары, «=?» вплотную к тексту) или
 * в нём несколько разных адресов.
 * @param {string} headerLine строка из mail.headerLines со снятыми складками
 * @returns {string}
 */
const writtenAddress = (headerLine) => {
  // Строка заголовка у mailparser «бинарная» (байты как символы): как и он,
  // читаем её как utf-8
  const text = Buffer.from(String(headerLine), "binary").toString("utf8");
  const clear = withoutQuotesAndComments(text.slice(text.indexOf(":") + 1));
  if (clear === null) return "";
  const plain = clear.replace(ENCODED_WORDS_RE, " ");
  // Остаток слова, которое целиком не распознано (пробел внутри, вплотную к
  // другому тексту), mailparser всё равно мог развернуть: заголовку нельзя
  // доверять
  if (plain.includes("=?")) return "";

  // Угловые скобки: нет совсем либо одна пара с адресом внутри. Пустая, непарная,
  // вложенная или вторая пара: mailparser берёт один адрес и отбрасывает остальное,
  // а сервер мог прочесть другой
  const open = plain.indexOf("<");
  const close = plain.indexOf(">");
  if (open !== -1 || close !== -1) {
    const single =
      open !== -1 &&
      close > open &&
      plain.indexOf("<", open + 1) === -1 &&
      plain.indexOf(">", close + 1) === -1;
    if (!single || !plain.slice(open + 1, close).includes("@")) return "";
  }

  // Адрес — слово с «@» целиком: у «boss@client.ru@» лишнюю «@» mailparser
  // отбрасывает, а сервер прочёл бы другой домен. Слов с «@» может быть несколько,
  // только если это один и тот же адрес («ivan@corp.ru <ivan@corp.ru>»); иначе
  // ящиков в заголовке несколько, и сервер мог взять не тот, что mailparser
  const words = plain.split(WORD_SPLIT_RE).filter((item) => item.includes("@"));
  if (words.some((item) => item.toLowerCase() !== words[0].toLowerCase())) {
    return "";
  }
  return words.length && ADDRESS_WORD_RE.test(words[0]) ? words[0] : "";
};

/**
 * Адрес отправителя в нижнем регистре; "" — отправитель неизвестен: нет From или
 * адреса в нём (пустой From, группа «undisclosed-recipients:;», текст без «@»)
 * либо не выполнено что-то из перечисленного в заголовке модуля (одна строка
 * From, один ящик, адрес написан открытым текстом, пределы длины). Домен в
 * punycode и в юникоде — один и тот же адрес. Адрес со знаком не из ASCII, чей
 * нижний регистр — ASCII (знак Кельвина), не называется: в нижнем регистре он
 * стал бы другим адресом, чем написан в заголовке.
 * @param {object} mail результат mailparser.simpleParser (нужны from и headerLines)
 * @returns {string}
 */
const senderAddress = (mail) => {
  const mailboxes = mail?.from?.value;
  if (!Array.isArray(mailboxes) || mailboxes.length !== 1) return "";
  // Без trim(): mailparser адрес уже обрезал по-своему, а лишнее по-нашему
  // (неразрывный пробел) выдаёт расхождение с заголовком
  const raw = String(mailboxes[0]?.address || "");
  if (!raw.includes("@") || raw.length > MAX_ADDRESS || lowersToAscii(raw)) {
    return "";
  }
  const address = raw.toLowerCase();

  // Сверка с исходным заголовком: у результата simpleParser строки всегда есть,
  // нет их — сверить не с чем. Два From — письмо невалидно (RFC 5322, п. 3.6):
  // mailparser берёт последний, проверку отправителя сервер мог сделать по первому
  const fromLines = Array.isArray(mail.headerLines)
    ? mail.headerLines.filter(
        (item) =>
          item?.key === "from" || FROM_LIKE_RE.test(String(item?.line ?? "")),
      )
    : [];
  if (fromLines.length !== 1) return "";
  const line = String(fromLines[0].line ?? "");
  // Предел раньше любого разбора строки
  if (line.length > MAX_FROM_LINE) return "";
  const unfolded = line.replace(FOLD_RE, "");
  if (!FROM_FIELD_RE.test(unfolded) || CONTROL_RE.test(unfolded)) return "";

  return comparable(writtenAddress(unfolded)) === comparable(address)
    ? address
    : "";
};

/**
 * Отправитель для показа (Ticket.realSender): «Имя <адрес>» или голый адрес.
 * Собирается из разобранного From, а не из его текста, и читается так, как
 * прочтёт сохранённую строку фронт (util/mail-sender.js#parseMailSender): он берёт
 * первое похожее на адрес в строке. Поэтому:
 *   - имя с «@» внутри и имя длиннее 200 знаков отбрасываются, остаётся один
 *     адрес: «"boss@client.ru" <x@evil.com>» показался бы как boss@client.ru;
 *   - если из адреса фронт прочёл бы другой домен («boss@client.ru+evil.com»,
 *     «boss@client.ru.», «"boss@client.ru"@evil.com»), строка пуста.
 * Пуста она и когда отправитель неизвестен (senderAddress).
 * @param {object} mail результат mailparser.simpleParser
 * @returns {string}
 */
const senderLine = (mail) => {
  const address = senderAddress(mail);
  if (!address) return "";
  const shown = address.match(SHOWN_ADDRESS_RE)?.[0];
  if (shown && senderDomain(shown) !== senderDomain(address)) return "";
  const name = String(mail.from.value[0].name || "")
    .replace(/\s+/g, " ")
    .trim();
  return name && name.length <= MAX_NAME && !name.includes("@")
    ? `${name} <${address}>`
    : address;
};

/**
 * Домен адреса — всё после последней «@», в нижнем регистре; "" — его нет или он
 * длиннее 253 знаков.
 * @param {string} address
 * @returns {string}
 */
const senderDomain = (address) => {
  const value = String(address || "");
  const at = value.lastIndexOf("@");
  if (at === -1) return "";
  const domain = value.slice(at + 1).trim().toLowerCase();
  return domain.length > MAX_DOMAIN ? "" : domain;
};

/**
 * Условие на Company.emailDomains: домен целиком и без учёта регистра.
 * Домены в карточке компании хранятся как их ввели («Client.RU»), и точное
 * `$in` промахивалось. Выражение, а не нормализация данных: не нужна
 * миграция, компаний сотни, индекса по полю нет. Пустой домен (в том числе
 * слишком длинный, см. senderDomain) не совпадает ни с чем.
 * @param {string} domain
 * @returns {object} часть фильтра для MongoCompany.findOne
 */
const companyDomainFilter = (domain) =>
  domain
    ? { emailDomains: new RegExp(`^${escapeRegExp(domain)}$`, "i") }
    : { emailDomains: { $in: [] } };

/**
 * Опознавать ли заявителя новой заявки по письму (по адресу и по номеру
 * телефона): только когда это включено в настройках и письмо не провалило
 * проверку отправителя. Иначе подделка открыла бы заявку от имени клиента, и
 * уведомления о ней ушли бы ему. Такая заявка — от инициатора по умолчанию;
 * компания по домену опознаётся как обычно.
 * @param {object} args
 * @param {boolean} args.identifyApplicant Preferences.identifyApplicant
 * @param {"pass"|"fail"|"none"} args.authVerdict services/mail/replyRouting#parseAuthResults
 * @returns {boolean}
 */
const mayIdentifyApplicant = ({ identifyApplicant, authVerdict }) =>
  Boolean(identifyApplicant) && authVerdict !== "fail";

/**
 * Что из заголовков едет дальше вместе с письмом:
 *   fromAddress — адрес отправителя (senderAddress);
 *   realSender  — он же для показа, с именем (senderLine);
 *   messageId   — Message-ID для распознавания повторов; undefined — его нет, в
 *                 нём одни скобки («<>», «< >»: mailparser пустое не отдаёт, а
 *                 скобки дописывает сам) или он длиннее 998 знаков;
 *   authResults — ПЕРВЫЙ заголовок Authentication-Results: его ставит наш
 *                 принимающий сервер (разбор — services/mail/replyRouting);
 *                 "" — заголовка нет.
 * @param {object} mail результат mailparser.simpleParser
 * @returns {{ fromAddress: string, realSender: string, messageId: string|undefined, authResults: string }}
 */
const inboundEnvelope = (mail) => {
  const authResults = mail?.headers?.get?.("authentication-results");
  const topmost = Array.isArray(authResults) ? authResults[0] : authResults;
  const messageId =
    typeof mail?.messageId === "string" ? mail.messageId.trim() : "";
  // Пустой Message-ID попал бы в разреженный индекс и совпал бы с любым другим
  const usable =
    messageId.length <= MAX_MESSAGE_ID && /[^<>\s]/.test(messageId);
  return {
    fromAddress: senderAddress(mail),
    realSender: senderLine(mail),
    messageId: usable ? messageId : undefined,
    authResults: typeof topmost === "string" ? topmost : "",
  };
};

/**
 * Письмо с этим Message-ID уже заведено — заявкой или комментарием. Повтор
 * бывает, когда пометка \Seen не дошла до сервера после обработки, или одно
 * письмо легло в ящик дважды (копия и пересылка на тот же ящик). Без
 * Message-ID повтор не узнать — такое письмо обрабатывается как новое.
 *
 * @param {string|undefined} messageId ищется только непустая строка: объект вроде
 *   { $ne: null } стал бы условием запроса и совпал с любой заявкой
 * @param {{ Ticket: object, Comment: object }} models модели (в тестах — заглушки)
 * @returns {Promise<null|{ ticketId: *, commentId?: * }>} commentId — повтор
 *   стал комментарием
 */
const findImportedMessage = async (messageId, { Ticket, Comment }) => {
  if (typeof messageId !== "string" || !messageId.trim()) return null;

  const ticket = await Ticket.exists({ emailMessageId: messageId });
  if (ticket) return { ticketId: ticket._id };

  const comment = await Comment.findOne(
    { emailMessageId: messageId },
    { _id: 1, ticketId: 1 },
  ).lean();
  return comment ? { ticketId: comment.ticketId, commentId: comment._id } : null;
};

module.exports = {
  senderAddress,
  senderLine,
  senderDomain,
  companyDomainFilter,
  mayIdentifyApplicant,
  inboundEnvelope,
  findImportedMessage,
};
