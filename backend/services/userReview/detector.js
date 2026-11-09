const { fingerprintTicket, normalizeAnalysis, matchSubjects } = require('./policy');
const { planTicketInput } = require('./input-plan');

/** Extract evidence only; no database writes, account changes or provider choice. */
const analyzeTicket = async ({ ticket = {}, comments = [], users = [], now, preferences, generateJson, aiActive, previous, onStage } = {}) => {
  const fingerprint = fingerprintTicket(ticket, comments);
  const empty = { fingerprint, events: [], matches: [], method: 'rules', inputFingerprint: null, inputChars: 0, sourceCount: 0, selectedSourceCount: 0 };
  let prefs = preferences;
  if (aiActive === false || (prefs && prefs.ai?.isActive !== true)) return { ...empty, skipped: 'ai_disabled' };
  if (!generateJson && !prefs) {
    prefs = await require('@/models/preferences').findOne({}).lean();
    if (prefs?.ai?.isActive !== true) return { ...empty, skipped: 'ai_disabled' };
  }
  const plan = planTicketInput({ ticket, comments, users, preferences: prefs });
  const metadata = { inputFingerprint: plan.inputFingerprint, inputChars: plan.inputChars, sourceCount: plan.sourceCount, selectedSourceCount: plan.selectedSourceCount };
  if (!plan.relevant) return { ...empty, ...metadata, skipped: 'irrelevant' };
  const context = { sources: plan.selectedSources, now };
  const match = (normalized, method) => {
    const events = normalized.map((event) => ({ ...event, exceptions: [...new Set(event.exceptions)] }));
    return { fingerprint, events, matches: matchSubjects(events, users, { companyId: ticket.company }), method, ...metadata };
  };
  if (previous?.inputFingerprint === plan.inputFingerprint && Array.isArray(previous.events)) {
    try {
      return match(normalizeAnalysis({ events: previous.events }, context), 'cache');
    } catch {
      // Stored output has the same trust boundary as a provider response. An
      // invalid cache is recomputed instead of being marked as a checked pass.
    }
  }
  const generate = generateJson ?? require('../aiService').generateJson;
  if (onStage) await onStage('ai');
  const result = await generate({ ...plan.prompt, maxTokens: 12000, requireActive: true });
  return match(normalizeAnalysis(result?.data ?? result, context), 'ai');
};

module.exports = { analyzeTicket };
