import type { McpKeyRow, McpScope } from "@/types/mcpKey";

// Ключи ИИ-агентов к MCP (Настройки → Интеграции → «Доступ ИИ-агентов»,
// components/Preferences/McpKeys.jsx). Чистые функции — проверяются node --test.

export type AgentKeysStatus =
  | { state: "warning"; title: string; hint: string }
  | { state: "ok"; title: string; at: string };

// Названия доступов — они же порядок, в котором доступы ключа перечисляются
// везде (строка списка, диалоги). Совпадает с backend MCP_SCOPES.
export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  knowledge: "База знаний",
  tickets: "Заявки",
};

// Ключи, выданные до появления доступов, в базе без поля `scopes` — читаются
// как доступ только к базе знаний (то же самое делает бэкенд,
// services/mcp/keys.js#normalizeScopes).
const normalizeScopes = (scopes?: McpScope[] | null): McpScope[] =>
  scopes && scopes.length ? scopes : ["knowledge"];

const orderedScopes = (scopes?: McpScope[] | null): McpScope[] => {
  const given = normalizeScopes(scopes);
  return (Object.keys(MCP_SCOPE_LABELS) as McpScope[]).filter((scope) =>
    given.includes(scope),
  );
};

/** «база знаний и заявки» — доступ ключа словами, в строке списка. */
export const scopeAccessLabel = (scopes?: McpScope[] | null): string =>
  orderedScopes(scopes)
    .map((scope) => MCP_SCOPE_LABELS[scope].toLowerCase())
    .join(" и ");

// Дательный падеж нужен только для фразы об утрате доступа при удалении.
const SCOPE_DATIVE: Record<McpScope, string> = {
  knowledge: "базе знаний",
  tickets: "заявкам",
};

/** «к базе знаний и заявкам» — что теряет агент при удалении ключа. */
export const scopeLossPhrase = (scopes?: McpScope[] | null): string =>
  `к ${orderedScopes(scopes)
    .map((scope) => SCOPE_DATIVE[scope])
    .join(" и ")}`;

/**
 * Одна строка состояния под ключами — самое важное из трёх:
 *   1. поиск секретов выключен, а какой-то ключ читает базу знаний (или
 *      ключей ещё нет вовсе) — решающее для безопасности, поэтому первым;
 *   2. ключ ни разу не работал — открытая дверь, за которой никто не следит;
 *   3. иначе — когда агенты обращались последний раз.
 * Ключи с одними «Заявки» не читают заметки, поэтому выключенный поиск
 * секретов их не касается.
 * `scanForSecrets` — черновое значение свитча секции «База знаний»: строка
 * меняется до «Сохранить», как и раньше.
 */
export const agentKeysStatus = ({
  keys,
  scanForSecrets,
}: {
  keys: McpKeyRow[];
  scanForSecrets: boolean;
}): AgentKeysStatus | null => {
  if (
    !scanForSecrets &&
    (!keys.length ||
      keys.some((key) => normalizeScopes(key.scopes).includes("knowledge")))
  ) {
    return {
      state: "warning",
      title: "Поиск секретов выключен",
      hint: "Агенты с доступом к базе знаний получают все проверенные заметки: пароли и ключи в них никто не ищет. Поиск включается в разделе «База знаний».",
    };
  }

  const unused = keys.find((key) => !key.lastUsedAt);
  if (unused) {
    return {
      state: "warning",
      title: `Ключ «${unused.name}» ещё не работал`,
      hint: `Если агента на нём так и не подключили, удалите ключ: неиспользуемый ключ зря открывает доступ ${scopeLossPhrase(unused.scopes)}.`,
    };
  }

  if (!keys.length) return null;

  const at = keys
    .map((key) => key.lastUsedAt as string)
    .reduce((latest, value) =>
      new Date(value).getTime() > new Date(latest).getTime() ? value : latest,
    );
  return { state: "ok", title: "Агенты подключались", at };
};

/**
 * Фрагмент конфига OpenClaw (JSON5, вставляется в корень `openclaw.json`).
 * `transport` обязателен: без него OpenClaw подключается по sse. Значения
 * экранируются JSON-кавычками — адрес или ключ не могут сломать фрагмент.
 * Имя сервера — `helpdesk`: сервер теперь отдаёт не только базу знаний
 * (`hd-helpdesk`, backend/services/mcp/server.js), но и заявки.
 */
export const openClawConfig = (endpoint: string, value: string): string =>
  [
    "mcp: { servers: { helpdesk: {",
    `  url: ${JSON.stringify(endpoint)},`,
    '  transport: "streamable-http",',
    `  headers: { Authorization: ${JSON.stringify(`Bearer ${value}`)} },`,
    "} } }",
  ].join("\n");
