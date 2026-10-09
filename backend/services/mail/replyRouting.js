/**
 * Ответ письмом в заявку: комментарий в неё или новая заявка.
 *
 * Метка `[F1-HD-N]` в теме (services/emailReplyStripper) говорит лишь, на что
 * ответили. Кто ответил, решают адрес отправителя и проверка подлинности,
 * которую провёл принимающий сервер. Прежде любое письмо с меткой ложилось
 * комментарием в №N: номера идут подряд, и кто угодно писал в чужую заявку от
 * имени клиента или сотрудника, а система рассылала этот текст её участникам
 * со своего адреса.
 *
 * Не принятый ответ человека не теряется: он заводится обычной новой заявкой,
 * первая строка описания называет №N и причину. В №N при этом не пишется
 * ничего и её участникам ничего не уходит. Не принятый робот (автоответ,
 * отбойник, рассылка) заявкой не становится вовсе: в логе №N остаётся одна
 * строка с его адресом.
 */

const { isDeniedAccount } = require("../accountDenial");

// Результат проверки в начале части заголовка: «dkim=pass header.d=…»;
// у метода бывает версия — «dkim/1=pass»
const RESULT_RE = /^([a-z0-9_.-]+)(?:\/\d+)?\s*=\s*([a-z0-9_-]+)/i;
// Комментарий в самом начале части: «(…) dmarc=fail»
const LEADING_COMMENT_RE = /^\([^()]*\)\s*/;

/**
 * Вердикт проверки отправителя по заголовку Authentication-Results
 * (RFC 8601):
 *
 *   fail — `dmarc=fail`, или `spf=fail` без `dkim=pass`;
 *   pass — `dmarc=pass` или `dkim=pass`;
 *   none — всё остальное: заголовка нет, он не разбирается, результаты
 *          мягкие (softfail, neutral, none).
 *
 * Верим только ПЕРВОМУ, верхнему заголовку — его ставит наш принимающий
 * сервер; всё, что ниже, приехало вместе с письмом. Это требование к
 * развёртыванию, а не свойство почты: сервер обязан добавлять свой заголовок
 * СВЕРХУ (Postfix с OpenDMARC и почтовые сервисы так и делают); дописанный
 * ниже уступил бы первое место поддельному из письма. Подделка ничего не даёт:
 * «pass» маршрутизирует так же, как «none», решает только «fail», и то лишь
 * против письма.
 *
 * Разбор нарочно простой: части по «;», результат — в начале части. Кавычки
 * и скобки внутри частей не разбираются: там лежат данные отправителя
 * (smtp.mailfrom, «domain of …»), и незакрытая кавычка или скобка не должна
 * проглотить следующий за ней «dmarc=fail». Лишняя часть из чужой «;» может
 * разве что изобразить «dkim=pass» — а его отправитель и так получает,
 * подписав письмо своим доменом.
 *
 * Чего проверка не ловит: подделку From у домена вовсе без записи DMARC — там
 * решает одна проверка участника (routeReply), а подделавшему открыты заявки,
 * видные в интерфейсе тому, чьим адресом он назвался. Любая запись DMARC, даже
 * `p=none`, уже даёт `dmarc=fail` на подделке её домена.
 *
 * @param {string|string[]|undefined} value `mail.headers.get("authentication-results")`:
 *   строка, при нескольких заголовках — массив сверху вниз
 * @returns {"pass"|"fail"|"none"}
 */
const parseAuthResults = (value) => {
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") return "none";

  const results = new Set();
  for (const part of header.split(";")) {
    const match = RESULT_RE.exec(part.trim().replace(LEADING_COMMENT_RE, ""));
    if (match) results.add(`${match[1]}=${match[2]}`.toLowerCase());
  }

  if (results.has("dmarc=fail")) return "fail";
  if (results.has("spf=fail") && !results.has("dkim=pass")) return "fail";
  if (results.has("dmarc=pass") || results.has("dkim=pass")) return "pass";
  return "none";
};

// Id строкой из всего, что его несёт: строка, ObjectId, снимок `{ _id }`,
// документ. У ObjectId Mongoose `_id` — он сам. Нужен лишь затем, чтобы знать,
// что у отправителя есть id: без него это не учётка.
const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  const id = value._id && value._id !== value ? value._id : value;
  if (typeof id === "string") return id;
  return typeof id.toHexString === "function" ? id.toHexString() : "";
};

/**
 * Участник заявки — тот, кому можно писать в неё письмом.
 *
 * Правило одно для всех, клиента и сотрудника: письмом в заявку пишет тот, кому
 * она видна в интерфейсе, и никто больше. Видимость считает вызывающий и
 * передаёт в `inScope` — тем же правилом, что у комментария из интерфейса:
 * canAccessTicket (services/ticketAccess, ярусы — services/ticketScope).
 * Это заявитель (в том числе по снимку у старых заявок), автор, ответственный и
 * сотрудник с доступом к заявке; клиенту — по скоупу роли: без права
 * «Видеть заявки своих компаний» только свои заявки, с ним — все заявки
 * компании клиента. Компания заявки сама по себе не пускает: рядовой клиент не
 * пишет письмом в заявки коллег. Здесь видимость не пересчитывается и связи
 * отправителя с заявкой не читаются: нужен один ответ, и только настоящее
 * `true` (обещание от забытого await «истинно», но не пускает).
 *
 * Учётке с основанием отказа (отключена, компания выключена, служебная —
 * services/accountDenial) нельзя никогда, даже если заявка ей видна: почта не
 * пускает тех, кого не пускает браузер.
 * @param {object|null} ticket заявка (документ или снимок); null — такой нет
 * @param {object|null} user пользователь; null — отправитель не опознан
 * @param {object} [options]
 * @param {boolean} [options.inScope] заявка видна пользователю в интерфейсе
 *   (canAccessTicket); не передан — не видна
 * @returns {boolean}
 */
const isTicketParticipant = (ticket, user, { inScope = false } = {}) => {
  if (!ticket || !idOf(user)) return false;
  if (isDeniedAccount(user)) return false;
  return inScope === true;
};

/**
 * Куда ответ в заявку: комментарием в неё — только от участника и если
 * письмо не провалило проверку отправителя; иначе — новая заявка.
 * @param {object} args
 * @param {object|null} args.ticket заявка №N из темы; null — такой нет
 * @param {object|null} args.sender пользователь с адресом отправителя; null — не опознан
 * @param {"pass"|"fail"|"none"} args.authVerdict parseAuthResults
 * @param {boolean} [args.inScope] заявка видна отправителю в интерфейсе (canAccessTicket)
 * @returns {"comment"|"newTicket"}
 */
const routeReply = ({ ticket, sender, authVerdict, inScope }) =>
  ticket &&
  authVerdict !== "fail" &&
  isTicketParticipant(ticket, sender, { inScope })
    ? "comment"
    : "newTicket";

/**
 * Первая строка описания заявки, в которую ушёл не принятый ответ: какую
 * заявку он называл и почему не стал в ней комментарием. Причины — в порядке
 * проверки: нет заявки → не прошла проверка отправителя → не участник.
 * @param {object} args
 * @param {number} args.ticketNum номер из темы
 * @param {object|null} args.ticket заявка с этим номером; null — такой нет
 * @param {"pass"|"fail"|"none"} args.authVerdict
 * @returns {string}
 */
const rerouteNote = ({ ticketNum, ticket, authVerdict }) => {
  const head = `Письмо пришло ответом на заявку №${ticketNum}, но`;
  if (!ticket) return `${head} такой заявки нет`;
  if (authVerdict === "fail") return `${head} не прошло проверку отправителя`;
  return `${head} отправитель в ней не участвует`;
};

/**
 * Описание новой заявки с пометкой. Описание — HTML-строка (карточка выводит
 * его разметкой, Telegram — через htmlToPlainLines), поэтому пометка идёт
 * отдельным абзацем, под ней — текст письма как пришёл. Без пометки описание
 * не меняется.
 * @param {string|undefined} description текст письма
 * @param {string|null} note rerouteNote; null — пометки нет
 * @returns {string|undefined}
 */
const withRerouteNote = (description, note) => {
  if (!note) return description;
  return description ? `<p>${note}</p>\n${description}` : `<p>${note}</p>`;
};

// В строку лога идёт только простой ASCII-адрес не длиннее 254 знаков: ленту
// заявки разбирают по фразам (services/ticketEvents), и адрес
// `"вернул"@evil.com` изобразил бы «Возвращена в работу», а адрес в пять
// тысяч знаков раздул бы лог. Всё прочее — «неизвестного отправителя».
const PLAIN_ADDRESS_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}$/i;

const logAddress = (address) =>
  typeof address === "string" &&
  address.length <= 254 &&
  PLAIN_ADDRESS_RE.test(address)
    ? address
    : "неизвестного отправителя";

/**
 * Строка в лог заявки об автоответе, которого в неё не пустили: только адрес
 * отправителя, без текста письма. Причина — в том же порядке, что у
 * rerouteNote: не прошла проверка отправителя → не участник.
 * @param {object} args
 * @param {string} args.fromAddress адрес отправителя; "" — его нет
 * @param {"pass"|"fail"|"none"} args.authVerdict
 * @returns {string}
 */
const rejectedAutoReplyEvent = ({ fromAddress, authVerdict }) => {
  const head = `автоответ от ${logAddress(fromAddress)} не принят:`;
  return authVerdict === "fail"
    ? `${head} не прошёл проверку отправителя`
    : `${head} отправитель не участвует в заявке`;
};

/**
 * Что сделать с ответом в №ticketNum:
 *   comment      — комментарий в заявку;
 *   autoReplyLog — только запись в лог: автоответ участника в ЗАКРЫТУЮ
 *                  заявку её не поднимает (services/machineMail);
 *   logOnly      — робот, которого в заявку не пустили: заявкой он не
 *                  становится, note — строка в лог №N (null — такой заявки
 *                  нет, остаётся журнал сервера);
 *   newTicket    — новая заявка, note — первая строка её описания.
 * @param {object} args
 * @param {number} args.ticketNum
 * @param {object|null} args.ticket
 * @param {object|null} args.sender
 * @param {"pass"|"fail"|"none"} args.authVerdict
 * @param {boolean} args.fromMachine isMachineMail
 * @param {string} [args.fromAddress] адрес отправителя — для строки лога
 * @param {boolean} [args.inScope] заявка видна отправителю в интерфейсе (canAccessTicket)
 * @returns {{ action: "comment"|"autoReplyLog"|"logOnly"|"newTicket", note: string|null }}
 */
const planReply = ({
  ticketNum,
  ticket,
  sender,
  authVerdict,
  fromMachine,
  fromAddress,
  inScope,
}) => {
  if (routeReply({ ticket, sender, authVerdict, inScope }) === "newTicket") {
    // Робот новой заявки не открывает: отбойник на уведомление или автоответ
    // с пересылки заводили бы по заявке на каждое письмо
    if (fromMachine) {
      return {
        action: "logOnly",
        note: ticket ? rejectedAutoReplyEvent({ fromAddress, authVerdict }) : null,
      };
    }
    return {
      action: "newTicket",
      note: rerouteNote({ ticketNum, ticket, authVerdict }),
    };
  }
  if (ticket.isClosed && fromMachine) {
    return { action: "autoReplyLog", note: null };
  }
  return { action: "comment", note: null };
};

module.exports = {
  parseAuthResults,
  isTicketParticipant,
  routeReply,
  rerouteNote,
  withRerouteNote,
  rejectedAutoReplyEvent,
  planReply,
};
