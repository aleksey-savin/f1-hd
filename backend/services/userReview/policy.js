const { createHash } = require('node:crypto');
const { htmlToPlainLines } = require('../../helpers/htmlToPlainText');
const { stripQuotedReply } = require('../emailReplyStripper');
const { formatAnswer } = require('../ticketQuestionnaire');
const { dayKey: appDayKey, DEFAULT_TIMEZONE } = require('../../utils/datetime');

const DAY_MS = 86400000;
const text = (value) => typeof value === 'string' ? value.trim() : '';
const folded = (value) => text(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ');
const idOf = (value) => value == null ? '' : String(value._id ?? value.id ?? value);
const dateOf = (value) => {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const iso = (value) => dateOf(value)?.toISOString() ?? null;
const dayKey = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return iso(value)?.slice(0, 10) === value ? value : null;
};

const normalizeSettings = (settings = {}) => ({
  enabled: settings?.enabled === true,
  suggestDeletion: settings?.suggestDeletion === true,
  disabledDays: Number.isSafeInteger(settings?.disabledDays) && settings.disabledDays > 0 ? settings.disabledDays : 90,
  inactivityDays: Number.isSafeInteger(settings?.inactivityDays) && settings.inactivityDays > 0 ? settings.inactivityDays : 180,
  historyPaused: settings?.historyPaused !== false,
});

const authorOf = (value) => value && typeof value === 'object' ? {
  name: [value.lastName, value.firstName].filter(Boolean).join(' '),
  email: text(value.email),
} : null;

// Only semantic inputs are hashed. Status changes, AI annotations and updatedAt
// must not send an unchanged ticket back to the provider.
const fingerprintTicket = (ticket = {}, comments = []) => createHash('sha256').update(JSON.stringify({
  title: text(ticket.title), description: text(ticket.description),
  createdAt: iso(ticket.createdAt), companyId: idOf(ticket.company),
  author: authorOf(ticket.applicant ?? ticket.createdBy),
  customFields: (ticket.customFields ?? []).map((field) => ({ name: field.name, type: field.type, value: field.value })),
  comments: [...comments].map((comment) => ({
    content: text(comment.content), quotedText: text(comment.quotedText),
    createdAt: iso(comment.createdAt), author: authorOf(comment.createdBy),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
})).digest('hex');

// Keep current prose, explicitly quoted letters and signatures separate. Existing
// mail parsing already stores quotedText; legacy HTML and plain replies need the
// same distinction before either grounding or prompting.
const splitHtmlQuotes = (html) => {
  const input = text(html);
  const parts = [];
  const marker = /<\/?blockquote\b[^>]*>/gi;
  let depth = 0;
  let offset = 0;
  let quoteStart = 0;
  let current = '';
  for (const match of input.matchAll(marker)) {
    const closing = match[0][1] === '/';
    if (!closing && depth++ === 0) {
      current += input.slice(offset, match.index);
      quoteStart = match.index + match[0].length;
    } else if (closing && depth > 0 && --depth === 0) {
      parts.push(input.slice(quoteStart, match.index));
      offset = match.index + match[0].length;
    }
  }
  if (depth > 0) parts.push(input.slice(quoteStart));
  else current += input.slice(offset);
  return { current, quoted: parts };
};

const buildSources = ({ ticket = {}, comments = [], timezone = DEFAULT_TIMEZONE } = {}) => {
  const sources = [];
  const add = (value, sourceId, at, author, role = 'current') => {
    const html = splitHtmlQuotes(value);
    const plain = htmlToPlainLines(html.current);
    const reply = stripQuotedReply(plain.replace(/^[\t ]+(?=>)/gm, ''), { preserveQuotedOnly: false });
    const signature = /(?:^|\n)(?:С уважением(?=\s|,|$)[^\n]*|Best regards\b[^\n]*|--\s*)/im.exec(reply.content);
    const current = signature ? reply.content.slice(0, signature.index).trim() : reply.content;
    const push = (body, sourceRole, suffix = '') => {
      const content = htmlToPlainLines(body);
      if (content) sources.push({ sourceId: `${sourceId}${suffix}`, sourceAt: iso(at), sourceDay: dateOf(at) ? appDayKey(at, timezone) : null, sourceRole, author: authorOf(author), text: content });
    };
    push(current, role);
    if (signature) push(reply.content.slice(signature.index), 'signature', ':signature');
    if (reply.quotedText) push(reply.quotedText, 'quoted', ':reply');
    html.quoted.forEach((body, index) => push(body, 'quoted', `:quote:${index}`));
  };
  const author = ticket.applicant ?? ticket.createdBy;
  add(ticket.title, 'title', ticket.createdAt, author);
  add(ticket.description, 'description', ticket.createdAt, author);
  (ticket.customFields ?? []).forEach((field, index) => {
    const answer = formatAnswer({ ...field, type: field.type ?? 'text' });
    if (answer) add(`${field.name}: ${answer}`, `field:${index}`, ticket.createdAt, author);
  });
  comments.forEach((comment, index) => {
    add(comment.content, `comment:${index}`, comment.createdAt, comment.createdBy);
    add(comment.quotedText, `comment:${index}:quoted`, comment.createdAt, comment.createdBy, 'quoted');
  });
  return sources;
};

const nameTokens = (value) => folded(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const tokenMatches = (left, right) => left === right || ((left.length === 1 || right.length === 1) && left[0] === right[0]);
const identityGrounded = (name, email, source) => {
  const body = folded(source.text);
  if (email && body.includes(folded(email))) return true;
  const tokens = nameTokens(name);
  const sourceTokens = nameTokens(source.text);
  // Inflected Russian names in quotations still ground the nominative name;
  // this is only extraction grounding, never account identity matching.
  return tokens.length > 0 && tokens.some((token) => token.length >= 3) && tokens.every((token) => sourceTokens.some((candidate) =>
    tokenMatches(token, candidate) || (token.length >= 4 && candidate.startsWith(token) && candidate.length <= token.length + 2)));
};

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Interpret only date forms present in this source, never the model's guessed
// year. Short years are anchored to the source century; omitted years use the
// source calendar year. Without a dated source both forms remain unresolved.
const dateEvidence = (value, source) => {
  const body = folded(value);
  const origin = dateOf(source.sourceDay);
  const sourceYear = origin?.getUTCFullYear();
  const days = new Set();
  let mentioned = false;
  const add = (year, month, date) => {
    mentioned = true;
    if (!year) return;
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    if (dayKey(candidate)) days.add(candidate);
  };
  for (const match of body.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) {
    add(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  for (const match of body.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?!\d)/g)) {
    let year = match[3] ? Number(match[3]) : sourceYear;
    if (match[3]?.length === 2) {
      year = sourceYear ? Math.floor(sourceYear / 100) * 100 + year : null;
      if (year && year - sourceYear > 50) year -= 100;
      if (year && sourceYear - year > 50) year += 100;
    }
    add(year, Number(match[2]), Number(match[1]));
  }
  const writtenDate = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTHS.join('|')})(?![а-яё])(?:\\s+(\\d{4})(?!\\d))?`, 'gu');
  for (const match of body.matchAll(writtenDate)) {
    add(match[3] ? Number(match[3]) : sourceYear, MONTHS.indexOf(match[2]) + 1, Number(match[1]));
  }
  const words = nameTokens(body);
  for (const [word, offset] of [['сегодня', 0], ['завтра', 1], ['послезавтра', 2], ['вчера', -1]]) {
    if (!words.includes(word)) continue;
    mentioned = true;
    if (origin) days.add(new Date(origin.getTime() + offset * DAY_MS).toISOString().slice(0, 10));
  }
  if (/последни[а-яё]*\s+рабочи[а-яё]*\s+д[а-яё]*|через\s+[^.!?\n]{1,35}(?:дн[а-яё]*|день|недел[а-яё]*|месяц[а-яё]*)|(?:с|со|после|в)\s+(?:следующ[а-яё]*\s+)?(?:понедельник[а-яё]*|вторник[а-яё]*|сред[а-яё]*|четверг[а-яё]*|пятниц[а-яё]*|суббот[а-яё]*|воскресень[а-яё]*|недел[а-яё]*)/u.test(body)) mentioned = true;
  return { days, mentioned };
};

const groundedDay = (value, source, quote) => {
  const day = dayKey(value);
  if (!day) return null;
  const quotedDates = dateEvidence(quote, source);
  const dates = quotedDates.mentioned ? quotedDates : dateEvidence(source.text, source);
  return dates.days.has(day) ? day : null;
};

const normalizeAnalysis = (raw, context = {}) => {
  if (!raw || !Array.isArray(raw.events)) throw new TypeError('AI user review: events must be an array');
  const sources = context.sources ?? buildSources(context);
  return raw.events.flatMap((input) => {
    if (!input || typeof input !== 'object') throw new TypeError('AI user review: invalid event');
    const name = text(input.name);
    const quote = text(input.quote);
    if (!name || !quote) throw new TypeError('AI user review: name and quote are required');
    if (!['departure', 'return', 'historical', 'unclear'].includes(input.employment)) throw new TypeError('AI user review: invalid employment');
    if (!['closeAll', 'restrict', 'preserve', 'handover', 'none'].includes(input.access)) throw new TypeError('AI user review: invalid access');
    for (const key of ['systems', 'exceptions']) {
      if (!Array.isArray(input[key]) || input[key].some((item) => typeof item !== 'string')) throw new TypeError(`AI user review: invalid ${key}`);
    }
    if (input.effectiveDate !== null && typeof input.effectiveDate !== 'string') throw new TypeError('AI user review: invalid effectiveDate');
    const grounding = sources.filter((source) => folded(source.text).includes(folded(quote)));
    // Unsupported model suggestions are expected during extraction. Drop the
    // individual suggestion without failing the ticket or losing other people.
    if (!grounding.length) return [];
    const email = text(input.email).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError('AI user review: invalid email');
    // If the same sentence is both quoted and current, retain the explicit
    // current occurrence. Model-supplied source metadata never controls this.
    const identityInQuote = identityGrounded(name, '', { text: quote });
    const preferred = grounding.filter((entry) => entry.sourceRole === 'current');
    const source = identityInQuote && (preferred.length ? preferred : grounding).sort((a, b) => (dateOf(b.sourceAt)?.getTime() ?? 0) - (dateOf(a.sourceAt)?.getTime() ?? 0))[0];
    if (!source) return [];
    if (email && !folded(quote).includes(folded(email))) return [];
    const historical = source.sourceRole !== 'current';
    const effectiveDate = input.effectiveDate === null ? null : groundedDay(input.effectiveDate, source, quote);
    const exceptions = [...new Set(input.exceptions.map(text).filter(Boolean))];
    const scheduled = dateEvidence(quote, source).mentioned || dateEvidence(source.text, source).mentioned;
    if (!effectiveDate && (input.effectiveDate || scheduled)) exceptions.push('Дата события не подтверждена источником');
    return [{
      name, ...(email ? { email } : {}),
      employment: historical ? 'historical' : input.employment,
      access: historical ? 'none' : input.access,
      effectiveDate, quote, systems: [...new Set(input.systems.map(text).filter(Boolean))], exceptions,
      sourceId: source.sourceId, sourceAt: source.sourceAt, sourceRole: source.sourceRole,
    }];
  });
};

const surnameVariants = (value) => {
  const raw = folded(value);
  const main = raw.replace(/\([^)]*\)/g, '').trim();
  const aliases = [...raw.matchAll(/\(([^)]*)\)/g)].map((match) => match[1]);
  return [main, ...aliases].map(nameTokens).filter((tokens) => tokens.length);
};
const nameMatchesUser = (name, user) => {
  const tokens = nameTokens(name);
  return surnameVariants(user.lastName).some((surname) => {
    const remaining = [...tokens];
    for (const token of surname) {
      const index = remaining.indexOf(token);
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
    if (!remaining.length) return true;
    const given = nameTokens(user.firstName);
    return remaining.length <= given.length && remaining.every((token, index) => tokenMatches(token, given[index]));
  });
};

const matchSubjects = (events, users, { companyId } = {}) => {
  const scope = idOf(companyId);
  // No company is not a licence to search all companies.
  const scoped = scope ? users.filter((user) => idOf(user.company) === scope) : [];
  return events.map((event) => {
    const named = scoped.filter((user) => nameMatchesUser(event.name, user));
    const emailed = event.email ? scoped.filter((user) => folded(user.email) === folded(event.email)) : [];
    const agreement = emailed.length ? emailed.filter((user) => named.includes(user)) : named;
    const exact = agreement.length === 1 && (!event.email || emailed.length === 1) ? agreement[0] : null;
    const candidates = [...new Set((exact ? [exact] : [...named, ...emailed]).map((user) => idOf(user)))].filter(Boolean);
    return { event, userId: exact ? idOf(exact) : null, candidates, match: exact ? 'matched' : candidates.length ? 'ambiguous' : 'unknown' };
  });
};

const reconcileEvidence = (evidence = [], now = new Date(), { timezone = DEFAULT_TIMEZONE } = {}) => {
  const ordered = evidence.filter((entry) => entry && entry.employment !== 'historical' && entry.sourceRole !== 'quoted' && entry.sourceRole !== 'signature')
    .map((entry, index) => ({ entry, index, at: dateOf(entry.sourceAt ?? entry.createdAt ?? entry.checkedAt ?? entry.effectiveDate)?.getTime() ?? 0 }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const latest = ordered.at(-1)?.entry ?? null;
  const result = { actionable: false, blocked: false, reason: 'no_departure', latest, evidence: [...evidence] };
  if (!latest) return result;
  const blocks = (entry) => entry.employment === 'return' || ['preserve', 'handover', 'restrict'].includes(entry.access) || entry.exceptions?.length;
  const sameTime = ordered.filter((item) => item.at === ordered.at(-1).at).map((item) => item.entry);
  if (sameTime.some(blocks) || ordered.some((item) => !item.at && blocks(item.entry))) {
    return { ...result, blocked: true, reason: 'counterevidence' };
  }
  if (latest.employment !== 'departure' || latest.access !== 'closeAll') return result;
  if (latest.effectiveDate && latest.effectiveDate > appDayKey(now, timezone)) return { ...result, reason: 'scheduled' };
  return { ...result, actionable: true, reason: 'departure' };
};

const deletionCandidates = (users, settings, now = new Date()) => {
  const config = normalizeSettings(settings);
  if (!config.suggestDeletion) return [];
  const clock = dateOf(now);
  if (!clock) return [];
  return users.filter((user) => {
    const disabledAt = dateOf(user.disabledAt);
    const expires = dateOf(user.banExpires);
    return user.banned === true && !user.deletedAt && !user.isService && !user.isServiceAccount && !user.isCloudTelephony && user.company?.isActive !== false && disabledAt && (!user.banExpires || (expires && expires > clock)) && clock.getTime() - disabledAt.getTime() > config.disabledDays * DAY_MS;
  });
};

module.exports = { normalizeSettings, fingerprintTicket, normalizeAnalysis, matchSubjects, reconcileEvidence, deletionCandidates, buildSources };
