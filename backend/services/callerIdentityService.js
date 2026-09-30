const MongoUser = require("@/models/user");
const MongoCompany = require("@/models/company");
const { isBanned } = require("@/services/authBan");
const { parsePhoneInput, toCanonicalPhone, isValidPhone } = require("@/services/phone");

// Любая последовательность, похожая на номер телефона. Внутри номера — пробел,
// табуляция и неразрывный пробел (его приносит почта из HTML), но не перевод
// строки: иначе номер и дата на следующей строке склеились бы в одного
// негодного кандидата, а два номера подряд — в одного вместо двух.
const PHONE_IN_TEXT = /\+?\d[\d \t\xa0()-]{4,}\d/g;
// Строка вида "Кто звонил: +7 999 123-45-67" из тела письма телефонии: метка и
// номер при ней. Номер необязателен — метка без него значит скрытого звонящего
// («Аноним», «скрыт», пусто). Между меткой и номером перевод строки допустим
// (в HTML метка и значение бывают в разных ячейках), внутри номера — нет.
// Между словами метки — любой пробел, и неразрывный тоже (\s его покрывает).
const KTO_ZVONIL = /кто\s+звонил\s*:?\s*(\+?\d[\d \t\xa0()-]{4,}\d)?/i;
// Похожий на настоящий российский номер: коды 3xx, 4xx, 8xx, 9xx. Отсекает ИНН,
// счета и прочие десятизначные числа, которыми полна подпись письма.
const PLAUSIBLE_RU = /^7[3489]\d{9}$/;

// Теги — в пробелы. Из сущностей — только неразрывный пробел (&nbsp;, &#160;,
// &#xa0;): им телефония отделяет слова метки «Кто звонил» и группы цифр номера.
const stripHtml = (html) =>
  String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160|#xa0);/gi, " ");

// Номера письма по порядку доверия. Метка «Кто звонил» есть — это письмо
// телефонии, и звонящий тот, что стоит в её строке: годный номер — единственный
// кандидат, скрытый («Аноним», «скрыт», пусто) — никого, запасных номеров из
// темы и тела нет. В том же письме лежат «Номер линии» (наш собственный номер)
// и время звонка, и скрытый звонок достался бы владельцу номера линии или
// темы. Раньше до этого не доходило лишь потому, что старый пакет `phone` не
// признавал городские номера (423, 812); теперь они опознаются, и защита нужна
// явно. Решает первая метка: пересланное ниже старое уведомление её не
// подменяет. Метки нет — тема, затем тело; там только правдоподобный
// российский или набранный с «+»: иначе первым «номером» стал бы ИНН из
// подписи. Наша собственная линия (ownPhones — Preferences.contacts.tel)
// кандидатом не бывает никогда: в теме и теле она выпадает, а стоит при
// метке — звонящего нет. Повторы выпадают. Номера — цифрами с кодом страны,
// как в базе (services/phone.js).
const extractCallerPhones = (
  { name, description, htmlDescription } = {},
  { ownPhones = [] } = {},
) => {
  const own = ownPhones.map((phone) => toCanonicalPhone(phone)).filter(Boolean);
  const bodyText = `${description || ""}\n${stripHtml(htmlDescription)}`;

  const callerLine = bodyText.match(KTO_ZVONIL);
  if (callerLine) {
    const digits = parsePhoneInput(callerLine[1]);
    return isValidPhone(digits) && !own.includes(digits) ? [digits] : [];
  }

  const phones = [];
  const add = (digits) => {
    if (!phones.includes(digits) && !own.includes(digits)) phones.push(digits);
  };

  for (const text of [name, bodyText]) {
    if (!text) continue;
    for (const candidate of String(text).match(PHONE_IN_TEXT) || []) {
      const digits = parsePhoneInput(candidate);
      const dialedWithPlus = candidate.trim().startsWith("+");
      if (PLAUSIBLE_RU.test(digits) || (dialedWithPlus && isValidPhone(digits))) {
        add(digits);
      }
    }
  }

  return phones;
};

// Кого можно узнать по номеру: живой человек (не служебная учётка и не аккаунт
// телефонии) из действующей компании; отключённых отсекает isBanned — у
// отключения бывает срок, сырому banned верить нельзя. Двоих достаточно, чтобы
// понять «номер не одного человека». Им же пользуется связывание собеседников
// «Диалогов» (services/messaging/identity.js).
const USER_FIELDS = "_id company isEndUser isServiceAccount banned banExpires";

const findUsersByPhone = async (phone) => {
  // Не полный номер — базу не спрашиваем: сеттер схемы превратил бы «+7» или
  // «abc» в пустую строку, и запрос по ней нашёл бы каждого без телефона
  if (!isValidPhone(phone)) return [];
  const candidates = await MongoUser.find({
    phone,
    isServiceAccount: { $ne: true },
    isCloudTelephony: { $ne: true },
    "company.isActive": { $ne: false },
  })
    .select(USER_FIELDS)
    .limit(5)
    .lean();
  return candidates.filter((user) => !isBanned(user)).slice(0, 2);
};

// Совпадение — только единственное: номер на двоих (общая линия офиса, муж и
// жена) не основание выбрать кого-то одного.
const onlyOne = (list) => (list.length === 1 ? list[0] : null);

// Заявитель по номеру и его компания (они связаны через user.company).
const findApplicantByPhone = async (phone) => {
  const match = onlyOne(await findUsersByPhone(phone));
  if (!match) return null;
  const applicant = await MongoUser.findById(match._id);
  if (!applicant) return null;
  const company = applicant.company?._id
    ? await MongoCompany.findById(applicant.company._id)
    : null;
  return { applicant, company };
};

// Компания по одному из её номеров; отключённые не опознаются.
const findCompanyByPhone = async (phone) => {
  // Та же охрана, что в findUsersByPhone: не полный номер базу не спрашивает
  if (!isValidPhone(phone)) return null;
  return onlyOne(
    await MongoCompany.find({ phones: phone, isActive: { $ne: false } }).limit(2),
  );
};

// Первый из номеров письма, который к кому-то привёл.
const findByAnyPhone = async (phones, lookup) => {
  for (const phone of phones) {
    const found = await lookup(phone);
    if (found) return found;
  }
  return null;
};

// Первый email из строки отправителя ("Имя <a@b.ru>" или "a@b.ru").
const extractEmail = (value) => {
  const match = String(value || "").match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  );
  return match ? match[0] : "";
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Пришла ли заявка с аккаунта облачной телефонии — определяем по email
// отправителя (ticket.realSender) и флагу isCloudTelephony у этого аккаунта.
// Email сравниваем без учёта регистра (почтовые адреса регистронезависимы).
const isCloudTelephonySender = async (realSender) => {
  const email = extractEmail(realSender);
  if (!email) return false;

  const account = await MongoUser.findOne({
    email: new RegExp(`^${escapeRegExp(email)}$`, "i"),
  }).select("isCloudTelephony");
  return !!account?.isCloudTelephony;
};

// Имя сотрудника, с которым говорил клиент, из поля "С кем говорил:" письма
// телефонии (оператор). Берём из текстового или HTML-тела заявки.
const extractOperatorName = (ticket) => {
  const sources = [ticket?.description, stripHtml(ticket?.htmlDescription)];

  for (const source of sources) {
    if (!source) continue;
    // Останавливаемся на переводе строки или на метке следующего поля письма.
    const match = source.match(
      /с\s*кем\s*говорил\s*:?\s*(.+?)\s*(?=номер линии|кто звонил|время звонк|длительн|\n|$)/i,
    );
    if (match) {
      const value = match[1].replace(/\s+/g, " ").trim();
      if (value && value.length <= 60) return value;
    }
  }

  return "";
};

// Достаём из заявки достоверные имя клиента, название компании и имя оператора,
// чтобы потом исправить искажённые распознаванием речи имена в диалоге и итоге.
// Возвращаем только реально опознанные значения — стандартные (дефолтные)
// аккаунт/компанию игнорируем, иначе мы бы подставили служебный аккаунт вместо
// звонящего.
const buildKnownCaller = async (ticket, prefs) => {
  const defaultApplicantId = prefs?.defaultApplicant?._id?.toString();
  const defaultCompanyId = prefs?.defaultCompany?._id?.toString();
  const context = {};

  const operatorName = extractOperatorName(ticket);
  if (operatorName) context.operatorName = operatorName;

  if (
    ticket?.applicantId &&
    ticket.applicantId.toString() !== defaultApplicantId
  ) {
    const applicant = await MongoUser.findById(ticket.applicantId).select(
      "firstName lastName isServiceAccount isCloudTelephony",
    );
    // Имя берём только у реального клиента — не у служебного/телефонного аккаунта,
    // даже если он не выставлен дефолтным в настройках. Иначе при неопознанном
    // звонящем мы бы «исправили» имена в диалоге на имя служебного аккаунта.
    const isRealClient =
      applicant && !applicant.isServiceAccount && !applicant.isCloudTelephony;
    const name = isRealClient
      ? `${applicant.lastName || ""} ${applicant.firstName || ""}`.trim()
      : "";
    if (name) context.applicantName = name;
  }

  if (
    ticket?.company?._id &&
    ticket.company._id.toString() !== defaultCompanyId &&
    ticket.company.alias
  ) {
    context.companyName = ticket.company.alias;
  }

  return context;
};

module.exports = {
  extractCallerPhones,
  findUsersByPhone,
  onlyOne,
  findApplicantByPhone,
  findCompanyByPhone,
  findByAnyPhone,
  buildKnownCaller,
  isCloudTelephonySender,
};
