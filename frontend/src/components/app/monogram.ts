// Монограмма для круглого аватара человека без фото (UserAvatar,
// ответственные, «Моя поддержка»): первые два символа первого слова с
// сохранением регистра; если первое слово из одной буквы — инициалы двух
// частей (D-Link→DL). У записей (компании, справочники) монограмм больше нет:
// плитка там либо картинка, либо глиф, либо её нет вовсе — см. app/ListRow.
export function monogramFor(name?: string): string {
  const parts = (name ?? "")
    .trim()
    .split(/[\s\-_./]+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts[0].length === 1 && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const word = parts[0];
  return word[0].toUpperCase() + (word[1] ?? "");
}
