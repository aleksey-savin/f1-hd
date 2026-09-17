import type { McpKeyRow } from "@/types/mcpKey";

// Ключи ИИ-агентов к базе знаний (Настройки → База знаний → «Доступ ИИ-агентов»,
// components/Preferences/McpKeys.jsx). Чистые функции — проверяются node --test.

export type AgentKeysStatus =
  | { state: "warning"; title: string; hint: string }
  | { state: "ok"; title: string; at: string };

/**
 * Одна строка состояния под ключами — самое важное из трёх:
 *   1. поиск секретов выключен — флаг утечки не ставится, и агенты получают все
 *      проверенные заметки (решающее для безопасности, поэтому первым);
 *   2. ключ ни разу не работал — открытая дверь, за которой никто не следит;
 *   3. иначе — когда агенты обращались последний раз.
 * `scanForSecrets` — черновое значение свитча секции: строка меняется до «Сохранить».
 */
export const agentKeysStatus = ({
  keys,
  scanForSecrets,
}: {
  keys: McpKeyRow[];
  scanForSecrets: boolean;
}): AgentKeysStatus | null => {
  if (!scanForSecrets) {
    return {
      state: "warning",
      title: "Поиск секретов выключен",
      hint: "Агенты получают все проверенные заметки: пароли и ключи в них никто не ищет. Включите «Искать секреты в заметках» выше.",
    };
  }

  const unused = keys.find((key) => !key.lastUsedAt);
  if (unused) {
    return {
      state: "warning",
      title: `Ключ «${unused.name}» ещё не работал`,
      hint: "Если агента на нём так и не подключили, удалите ключ: неиспользуемый ключ открывает базу знаний зря.",
    };
  }

  if (!keys.length) return null;

  const at = keys
    .map((key) => key.lastUsedAt as string)
    .reduce((latest, value) =>
      new Date(value).getTime() > new Date(latest).getTime() ? value : latest,
    );
  return { state: "ok", title: "Агенты обращались к базе знаний", at };
};

/**
 * Фрагмент конфига OpenClaw (JSON5, вставляется в корень `openclaw.json`).
 * `transport` обязателен: без него OpenClaw подключается по sse. Значения
 * экранируются JSON-кавычками — адрес или ключ не могут сломать фрагмент.
 */
export const openClawConfig = (endpoint: string, value: string): string =>
  [
    "mcp: { servers: { helpdesk_kb: {",
    `  url: ${JSON.stringify(endpoint)},`,
    '  transport: "streamable-http",',
    `  headers: { Authorization: ${JSON.stringify(`Bearer ${value}`)} },`,
    "} } }",
  ].join("\n");
