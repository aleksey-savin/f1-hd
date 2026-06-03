const { phone } = require("phone");

const MongoUser = require("@/models/user");
const MongoCompany = require("@/models/company");

// Любая последовательность, похожая на номер телефона.
const PHONE_IN_TEXT = /\+?\d[\d\s()-]{4,}\d/g;
// Строка вида "Кто звонил: +7 999 123-45-67" из тела письма телефонии.
const KTO_ZVONIL = /кто звонил\s*:?\s*(\+?\d[\d\s()-]{4,}\d)/i;

const stripHtml = (html) => String(html || "").replace(/<[^>]+>/g, " ");

// Приводим номер к формату E.164 (+7XXXXXXXXXX) или возвращаем null.
const normalizeRuPhone = (raw) => {
  if (!raw) return null;

  let digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }

  const result = phone(`+${digits}`, { country: "RU" });
  return result.isValid ? result.phoneNumber : null;
};

// Достаём номер звонящего из темы и тела письма. Приоритет — явная пометка
// "Кто звонил:", затем номер в теме, затем любой номер в теле.
const extractCallerPhone = ({ name, description, htmlDescription } = {}) => {
  const bodyText = `${description || ""}\n${stripHtml(htmlDescription)}`;

  const marked = bodyText.match(KTO_ZVONIL);
  if (marked) {
    const normalized = normalizeRuPhone(marked[1]);
    if (normalized) return normalized;
  }

  for (const text of [name, bodyText]) {
    if (!text) continue;
    for (const candidate of String(text).match(PHONE_IN_TEXT) || []) {
      const normalized = normalizeRuPhone(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
};

// Регулярка, совпадающая со строкой, заканчивающейся на 10 значимых цифр номера,
// игнорируя разделители (+7 999, 8 (999), 9991234567 и т.п.).
const buildPhoneSuffixRegex = (normalizedPhone) => {
  const last10 = normalizedPhone.replace(/\D/g, "").slice(-10);
  if (last10.length !== 10) return null;
  return new RegExp(`${last10.split("").join("[\\s()-]*")}$`);
};

// Ищем пользователя по номеру телефона и возвращаем его вместе с привязанной
// компанией (они связаны через user.company).
const findApplicantByPhone = async (rawPhone) => {
  const normalized = normalizeRuPhone(rawPhone);
  if (!normalized) return null;

  const suffixRegex = buildPhoneSuffixRegex(normalized);
  if (!suffixRegex) return null;

  const applicant = await MongoUser.findOne({ phone: suffixRegex });
  if (!applicant) return null;

  const company = applicant.company?._id
    ? await MongoCompany.findById(applicant.company._id)
    : null;

  return { applicant, company };
};

// Ищем компанию по одному из её номеров.
const findCompanyByPhone = async (rawPhone) => {
  const normalized = normalizeRuPhone(rawPhone);
  if (!normalized) return null;

  const suffixRegex = buildPhoneSuffixRegex(normalized);
  if (!suffixRegex) return null;

  return MongoCompany.findOne({ phones: suffixRegex });
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
  extractCallerPhone,
  normalizeRuPhone,
  findApplicantByPhone,
  findCompanyByPhone,
  buildKnownCaller,
  isCloudTelephonySender,
};
