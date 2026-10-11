// Заметку завёл ИИ-агент по MCP: поле `agent` ставит бэкенд и не снимает
// никогда (backend/models/knowledgeNote.js). Автор — человек, попросивший
// агента; ключ показываем именем, id — никогда.

type Person = { firstName?: string; lastName?: string };
type NoteLike = {
  agent?: { keyId?: string; keyName?: string } | null;
  createdBy?: Person | string | null;
} | null | undefined;

// «Иванов И.» — тот же вид, что formatActor в knowledgeNoteTypes.js; повторён
// здесь, потому что тот модуль тянет иконки и не подключается в node --test.
const shortName = (person: Person | string | null | undefined): string | null => {
  if (!person || typeof person === "string") return null;
  const lastName = (person.lastName || "").trim();
  const firstName = (person.firstName || "").trim();
  if (!lastName) return firstName || null;
  return firstName ? `${lastName} ${firstName[0]}.` : lastName;
};

export const agentOrigin = (note: NoteLike): { keyName: string; requester: string | null } | null => {
  if (!note?.agent?.keyId) return null;
  return { keyName: (note.agent.keyName || "").trim(), requester: shortName(note.createdBy) };
};
