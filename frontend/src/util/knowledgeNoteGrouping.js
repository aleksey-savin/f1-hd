// Группировка заметок по компании для списка базы знаний.
//
// Компания заметки берётся из двух источников: прямой привязки к компаниям и
// компании привязанного пользователя (заметка про конкретного сотрудника
// принадлежит его компании). Заметка без компаний — «общая»: она либо вовсе без
// привязок, либо привязана только к категориям заявок, а значит одинаково
// применима в любой компании. Такие идут первой группой.
//
// Заметка, привязанная к нескольким компаниям, попадает в каждую из них — иначе
// в списке своей компании сотрудник её не найдёт.

export const GLOBAL_GROUP_KEY = "__global";
const GLOBAL_GROUP_TITLE = "Общие";

// Уникальные алиасы компаний заметки (прямых и через пользователей)
export const companyAliases = (note) => {
  const aliases = new Set();
  (note.companies || []).forEach((company) => {
    if (company?.alias) {
      aliases.add(company.alias);
    }
  });
  (note.users || []).forEach((user) => {
    if (user?.company?.alias) {
      aliases.add(user.company.alias);
    }
  });
  return [...aliases];
};

// [{ key, title, notes }] — «Общие» первой, дальше компании по алфавиту.
// Порядок заметок внутри группы сохраняется таким, каким пришёл (список уже
// отсортирован выбранной сортировкой).
export const groupNotesByCompany = (notes = []) => {
  const groups = new Map();

  const push = (key, title, note) => {
    if (!groups.has(key)) {
      groups.set(key, { key, title, notes: [] });
    }
    groups.get(key).notes.push(note);
  };

  notes.forEach((note) => {
    const aliases = companyAliases(note);
    if (aliases.length === 0) {
      return push(GLOBAL_GROUP_KEY, GLOBAL_GROUP_TITLE, note);
    }
    aliases.forEach((alias) => push(alias, alias, note));
  });

  const global = groups.get(GLOBAL_GROUP_KEY);
  const companies = [...groups.values()]
    .filter((group) => group.key !== GLOBAL_GROUP_KEY)
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));

  return global ? [global, ...companies] : companies;
};

// Ключи групп, в которые попадает заметка (нужно, чтобы раскрыть папку с
// открытой заметкой).
export const groupKeysOfNote = (note) => {
  const aliases = companyAliases(note);
  return aliases.length ? aliases : [GLOBAL_GROUP_KEY];
};
