const { createHash } = require('node:crypto');
const { buildSources } = require('./policy');
const { resolveTimezone } = require('../../utils/datetime');
const buildPrompt = require('@/prompts/userReview');

// Change this when selection semantics change. The complete actual prompt is
// hashed too, so prompt edits automatically invalidate persisted model output.
const INPUT_VERSION = 'user-review-input-v4';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fold = (value) => String(value ?? '').toLowerCase().replace(/ё/g, 'е');
const tokens = (value) => fold(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const idOf = (value) => value == null ? '' : String(value._id ?? value);

const EMPLOYMENT = /увол[а-яё]*|последни[а-яё]*\s+рабочи[а-яё]*\s+д[а-яё]*|повторн[а-яё]*\s+при[её]м|вновь\s+принят[а-яё]*/iu;
const IMPLICIT_EMPLOYMENT = /(?:больше|уже)\s+не\s+работа[а-яё]*|не\s+работа[а-яё]*\s+(?:у\s+нас|в\s+компании|в\s+организации)|(?:ранее|раньше|прежде)\s+работал[а-яё]*|(?:перестал[а-яё]*|прекратил[а-яё]*)\s+работ[а-яё]*/iu;
const PERSON_REFERENCE = /(?:^|[^а-яё])(?:он|она|они|человек)(?=$|[^а-яё])/iu;
const RETURN_TECH = /(?:ошибка|проблема|программа|система|сервер|сервис|доступ)[^.!?\n]{0,35}(?:вернул(?:ся|ась|ись)|возвраща(?:ется|ются))|(?:вернул(?:ся|ась|ись)|возвраща(?:ется|ются))\s+(?:ошиб[а-яё]*|проблем[а-яё]*|сбой[а-яё]*|код|ответ|доступ[а-яё]*)/iu;
const RETURN = /вернул(?:ся|ась|ись)|возвраща(?:ется|ются)|повторно\s+принят|снова\s+(?:работа[а-яё]*|принят[а-яё]*)/iu;
const PEOPLE = /сотрудник[а-яё]*|работник[а-яё]*|коллег[а-яё]*|работодател[а-яё]*|фамили[а-яё]*|фио(?=$|[^а-яё])/iu;
const ACCESS = /доступ[а-яё]*|уч[её]т[а-яё]*|аккаунт[а-яё]*|почт[а-яё]*|ящик[а-яё]*|во\s+всех\s+систем[а-яё]*|vpn\b/iu;
const CLOSE = /закры[а-яё]*|отключ[а-яё]*|заблокир(?:овать|уйте|овали)|блокир(?:овать|уйте|овка)|огранич[а-яё]*|удал(?:ить|ите|ение)/iu;
const DIRECT_CLOSE = /(?<![а-яё])(?:отключ(?:ить|ите)|закрыть|закройте|заблокир(?:овать|уйте)|блокир(?:овать|уйте)|огранич(?:ить|ьте)|удал(?:ить|ите))/iu;
const KEEP = /(?<![а-яё])(?:восстанов[а-яё]*|разблокир[а-яё]*|сохран[а-яё]*|остав[а-яё]*|переда[а-яё]*|переоформ[а-яё]*|переназнач[а-яё]*)/iu;
const REPAIR = /ошиб[а-яё]*|сбой[а-яё]*|парол[а-яё]*|не\s+(?:работа[а-яё]*|мож[а-яё]*|могу|уда[её]тся|получается)|резервн[а-яё]*\s+копи[а-яё]*|б[еэ]кап[а-яё]*|backup/iu;
const ACCESS_NEED = /(?:доступ[а-яё]*|уч[её]тк[а-яё]*|аккаунт[а-яё]*|права)[^.!?\n]{0,80}(?:нуж[а-яё]*|требу[а-яё]*|необходим[а-яё]*|использу[а-яё]*)|(?:нуж[а-яё]*|необходим[а-яё]*)[^.!?\n]{0,80}(?:доступ[а-яё]*|уч[её]тк[а-яё]*|аккаунт[а-яё]*|права)|продолжа[а-яё]*\s+(?:сотрудничеств[а-яё]*|работ[а-яё]*\s+по\s+договору)/iu;
const CONTINUING_EMPLOYMENT = /работа(?:ет|ют)\s+(?:у\s+нас|в\s+компании|в\s+организации)|оста[её]тся\s+(?:работать|в\s+компании)|действующ[а-яё]*\s+сотрудник[а-яё]*|продолжа[а-яё]*\s+(?:работ[а-яё]*|проект[а-яё]*|сотрудничеств[а-яё]*)/iu;
const QUOTE_REFERENCE = /ниже|выше|предыдущ[а-яё]*|цитат[а-яё]*|согласно|просьб[а-яё]*\s+из\s+письма|как\s+(?:просил[а-яё]*|в\s+письме)/iu;

const properName = (value) => /[А-ЯЁA-Z][а-яёa-z\d-]+\s+(?:[А-ЯЁA-Z][а-яёa-z-]+|[А-ЯЁA-Z]\.)/u.test(String(value));
const singleNameDeparture = (value) => /(?:^|[.!?]\s+)[А-ЯЁA-Z][а-яёa-z-]+,?\s+(?:больше|уже)\s+не\s+работа[а-яё]*/u.test(String(value));
const TECHNICAL_SUBJECT = /(?:программ[а-яё]*|приложен[а-яё]*|сервер[а-яё]*|сервис[а-яё]*|систем[а-яё]*|лицензи[а-яё]*|оборудован[а-яё]*)[^.!?\n]{0,80}(?:больше\s+не\s+работа[а-яё]*|перестал[а-яё]*\s+работа[а-яё]*|раньше\s+работал[а-яё]*)/iu;

// Only explicit structured machine output is discardable after a live signal.
// Unknown human prose may contain a new qualifier in any wording and must alter
// the cached input, regardless of its distance from the original request.
const metricData = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return true;
  if (Array.isArray(value)) return value.every(metricData);
  return value && typeof value === 'object' && Object.entries(value).every(([key, item]) => /^[A-Za-z0-9_.:-]+$/.test(key) && metricData(item));
};
const machineRecord = (record, root = true) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (root && !['diagnostic', 'metrics', 'health'].includes(record.type)) return false;
  const fields = Object.entries(record);
  if (!fields.some(([key]) => key !== 'type')) return false;
  return fields.every(([key, value]) => {
    switch (key) {
      case 'type': return ['diagnostic', 'metrics', 'health'].includes(value);
      case 'metrics': return metricData(value);
      case 'checks': return Array.isArray(value) && value.every((item) => machineRecord(item, false));
      case 'sequence': return Number.isSafeInteger(value);
      case 'code': return typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(value);
      case 'status': return typeof value === 'boolean' || typeof value === 'string' && ['ok', 'failed', 'healthy', 'unhealthy', 'up', 'down', 'pass', 'fail'].includes(value.toLowerCase());
      case 'level': return typeof value === 'string' && ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(value.toLowerCase());
      case 'timestamp': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime());
      default: return false; // Unknown fields may carry human prose or intent.
    }
  });
};
const structuredDiagnostic = (source) => {
  if (!/^[{[]/.test(source.text)) return false;
  try {
    const payload = JSON.parse(source.text);
    const records = Array.isArray(payload) ? payload : [payload];
    return records.length > 0 && records.every((record) => machineRecord(record));
  } catch {
    return false;
  }
};

const emptyAcknowledgement = (source) => /^(?:ок|ok|спасибо|благодарю|принято)[.!…\s]*$/iu.test(source.text);

const shortIdentity = (source) => {
  if (source.sourceId === 'title' || source.sourceId.startsWith('comment:') || source.text.length > 160) return false;
  const words = tokens(source.text);
  if (!words.length || words.some((word) => ['принято', 'спасибо', 'здравствуйте', 'добрый', 'день', 'актуально', 'ок'].includes(word))) return false;
  return /^(?:[А-ЯЁ][а-яё-]+|[А-ЯЁ]\.)(?:[\s,;]+(?:[А-ЯЁ][а-яё-]+|[А-ЯЁ]\.))*[.]?$/u.test(source.text);
};

const providerIdentity = (preferences) => {
  const ai = preferences?.ai;
  const provider = ai?.provider ?? null;
  const config = ai?.[provider] ?? {};
  return { provider, model: config.model ?? null, baseUrl: config.baseUrl ?? null, folderId: config.folderId ?? null };
};

const stableSources = (ticket, comments, timezone) => buildSources({ ticket, comments, timezone }).map((source) => ({
  ...source,
  sourceId: source.sourceId.replace(/^comment:(\d+)/, (_match, index) => {
    const comment = comments[Number(index)];
    const key = idOf(comment?._id) || hash(JSON.stringify({ content: comment?.content, quotedText: comment?.quotedText, createdAt: comment?.createdAt })).slice(0, 24);
    return `comment:${key}`;
  }),
}));

/** Pure, read-only selection used by the live detector and offline cost audit. */
const planTicketInput = ({ ticket = {}, comments = [], users = [], preferences, timezone = resolveTimezone(preferences) } = {}) => {
  const sources = stableSources(ticket, comments, timezone);
  const current = sources.filter((source) => source.sourceRole === 'current');
  const names = new Set(users.filter((user) => !user.isServiceAccount && !user.isCloudTelephony && idOf(user.company) === idOf(ticket.company)).flatMap((user) => [...tokens(user.lastName), ...tokens(user.firstName)]).filter((name) => name.length > 2));
  const employmentTitle = current.some((source) => source.sourceId === 'title' && (EMPLOYMENT.test(source.text) || RETURN.test(source.text)));
  const person = (source) => PEOPLE.test(source.text) || properName(source.text) || singleNameDeparture(source.text) || tokens(source.text).some((token) => names.has(token)) || employmentTitle && shortIdentity(source);
  const employmentOf = (source) => EMPLOYMENT.test(source.text) || source.text.split(/(?<=[а-яёa-z0-9])[.!?]\s+|\n+/u).some((sentence) => IMPLICIT_EMPLOYMENT.test(sentence) && !TECHNICAL_SUBJECT.test(sentence) && (person({ ...source, text: sentence }) || PERSON_REFERENCE.test(sentence)));
  const personnel = current.some((source) => employmentOf(source) || person(source) && !REPAIR.test(source.text));
  const attachedQuotes = (source) => sources.filter((entry) => entry.sourceRole === 'quoted' && entry.sourceId.startsWith(`${source.sourceId}:`));
  const info = current.map((source) => {
    const employment = employmentOf(source);
    const identified = person(source);
    const repair = REPAIR.test(source.text);
    const access = ACCESS.test(source.text);
    const liveQuote = QUOTE_REFERENCE.test(source.text) && /выполн[а-яё]*|сдела[а-яё]*|прошу|подтвержд[а-яё]*|согласно/iu.test(source.text) &&
      attachedQuotes(source).some((entry) => employmentOf(entry) || person(entry) && (RETURN.test(entry.text) || ACCESS.test(entry.text) && (CLOSE.test(entry.text) || KEEP.test(entry.text))));
    const accessAction = access && (identified || personnel) &&
      (DIRECT_CLOSE.test(source.text) || !repair && (CLOSE.test(source.text) || KEEP.test(source.text)));
    const returning = RETURN.test(source.text) && !RETURN_TECH.test(source.text) && (identified || source.sourceId === 'title' && personnel);
    const continuing = identified && CONTINUING_EMPLOYMENT.test(source.text) && !repair;
    const accessNeeded = ACCESS_NEED.test(source.text) && (identified || personnel);
    const candidate = employment || returning || accessAction || continuing || accessNeeded || liveQuote;
    // A generic old subject line plus a quoted letter is not a live request.
    const titleOnly = source.sourceId === 'title' && !identified && !current.some((entry) => entry.sourceId !== 'title' && (person(entry) || ACCESS.test(entry.text) && !REPAIR.test(entry.text)));
    return { source, identified, candidate: candidate && !titleOnly };
  });
  const selected = new Set(info.filter((entry) => entry.candidate).map((entry) => entry.source));
  if (selected.size) {
    // Once there is a live signal, keep all current human prose. Neither a
    // keyword list nor adjacency can prove a late reply is irrelevant.
    for (const entry of info) {
      if (entry.candidate || !structuredDiagnostic(entry.source) && !emptyAcknowledgement(entry.source)) selected.add(entry.source);
    }
    // Include quoted background only when the selected current message refers
    // to it. Quoted history itself never creates a candidate.
    for (const entry of info.filter((item) => selected.has(item.source) && QUOTE_REFERENCE.test(item.source.text))) {
      const base = entry.source.sourceId;
      for (const source of sources) {
        if (source.sourceRole === 'quoted' && source.sourceId.startsWith(`${base}:`)) selected.add(source);
      }
    }
  }
  const selectedSources = sources.filter((source) => selected.has(source));
  const relevant = selectedSources.some((source) => source.sourceRole === 'current');
  const prompt = relevant ? buildPrompt({ sources: selectedSources, timezone }) : null;
  return {
    version: INPUT_VERSION, relevant, sources, selectedSources, prompt,
    inputFingerprint: prompt ? hash(JSON.stringify({ version: INPUT_VERSION, timezone, provider: providerIdentity(preferences), ...prompt })) : null,
    inputChars: prompt ? prompt.system.length + prompt.user.length : 0,
    sourceCount: sources.length, selectedSourceCount: selectedSources.length,
  };
};

module.exports = { planTicketInput };
