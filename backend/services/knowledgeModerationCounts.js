const KnowledgeNote = require("../models/knowledgeNote");

// Счётчики очередей модерации базы знаний. Один источник на два входа —
// GET /knowledge-notes/moderation-summary и снимок в preferences.getInitial:
// раньше эти четыре запроса стояли двумя копиями и разъезжались бы при правке.
//
// Архивные заметки в счётчики не идут (они «исчезли»), кроме секретов — утечку
// нужно видеть и в архиве.
const QUEUES = {
  pendingApproval: { approved: { $ne: true }, archivedAt: null },
  pendingDeletion: { pendingDeletion: true, archivedAt: null },
  pendingArchive: { pendingArchive: true, archivedAt: null },
  secretsFlagged: { "secretsScan.flagged": true },
};

const ZERO = {
  pendingApproval: 0,
  pendingDeletion: 0,
  pendingArchive: 0,
  secretsFlagged: 0,
  total: 0,
};

// `total` — число ЗАМЕТОК, ждущих модератора, а не сумма очередей: очереди
// пересекаются (непроверенная заметка с находкой сканера лежит сразу в двух), и
// сумма насчитывала бы одну и ту же заметку дважды.
//
// scanForSecrets=false — очередь утечек в интерфейсе скрыта (её счётчик мог
// остаться от прошлых сканов), поэтому в `total` она тоже не идёт: значок не
// должен обещать работу, к которой некуда перейти.
const getModerationCounts = async ({ scanForSecrets = true } = {}) => {
  const keys = Object.keys(QUEUES);
  const totalQueues = keys
    .filter((key) => scanForSecrets || key !== "secretsFlagged")
    .map((key) => QUEUES[key]);

  const results = await Promise.all([
    ...keys.map((key) => KnowledgeNote.countDocuments(QUEUES[key])),
    KnowledgeNote.countDocuments({ $or: totalQueues }),
  ]);

  const counts = { ...ZERO };
  keys.forEach((key, index) => {
    counts[key] = results[index];
  });
  counts.total = results[keys.length];

  return counts;
};

module.exports = { getModerationCounts, ZERO_COUNTS: ZERO };
