import type { McpKeyRow, McpScope } from "@/types/mcpKey";

// Ключи ИИ-агентов к MCP (Настройки → Интеграции → «Доступ ИИ-агентов»,
// components/Preferences/McpKeys.jsx). Чистые функции — проверяются node --test.

export type AgentKeysStatus =
  | { state: "warning"; title: string; hint: string }
  | { state: "ok"; title: string; at: string };

export type McpResource = {
  key: string;
  label: string;
  /** «к чему» — для фразы об утрате доступа при удалении ключа */
  dative: string;
  read: McpScope;
  write?: McpScope;
};

// Ресурсы и порядок, в котором доступ ключа показывается везде (флажки,
// строка списка, диалоги). «Запись» есть только там, где у агента есть
// инструменты записи; хранятся доступы прежними строками (backend MCP_SCOPES).
export const MCP_RESOURCES: McpResource[] = [
  { key: "knowledge", label: "База знаний", dative: "базе знаний", read: "knowledge", write: "knowledgeWrite" },
  { key: "tickets", label: "Заявки", dative: "заявкам", read: "tickets" },
  { key: "companies", label: "Компании", dative: "компаниям", read: "companies" },
  { key: "users", label: "Пользователи", dative: "пользователям", read: "users" },
  { key: "inventory", label: "Инвентарь", dative: "инвентарю", read: "inventory", write: "inventoryChanges" },
  { key: "mikrotik", label: "Mikrotik", dative: "Mikrotik", read: "mikrotik", write: "mikrotikChanges" },
];

const SCOPE_ORDER: McpScope[] = MCP_RESOURCES.flatMap(({ read, write }) => (write ? [read, write] : [read]));

// Порядок ресурсов, чужие значения — в хвосте как пришли
const inResourceOrder = (scopes: Set<McpScope>): McpScope[] => [
  ...SCOPE_ORDER.filter((item) => scopes.has(item)),
  ...[...scopes].filter((item) => !SCOPE_ORDER.includes(item)),
];

/**
 * Флажок доступа: «Запись» без «Чтения» агенту бесполезна, поэтому запись
 * включает чтение, а снятое чтение снимает запись.
 */
export const toggleScope = (scopes: McpScope[], scope: McpScope, checked: boolean): McpScope[] => {
  const resource = MCP_RESOURCES.find(({ read, write }) => read === scope || write === scope);
  const next = new Set(scopes);
  if (checked) {
    next.add(scope);
    if (resource?.write === scope) next.add(resource.read);
  } else {
    next.delete(scope);
    if (resource?.read === scope && resource.write) next.delete(resource.write);
  }
  return inResourceOrder(next);
};

/**
 * Доступы перед отправкой на сервер: каждой «Записи» — её «Чтение». Флажки
 * такого и так не дают; ключ с одной записью бывает только сохранённым раньше —
 * диалог показывает его как есть, а сохранение приводит к правилу.
 */
export const withReadForWrite = (scopes: McpScope[]): McpScope[] => {
  const next = new Set(scopes);
  MCP_RESOURCES.forEach(({ read, write }) => {
    if (write && next.has(write)) next.add(read);
  });
  return inResourceOrder(next);
};

// «а, б и в»
const joinList = (items: string[]): string =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;

// Ключи, выданные до появления доступов, в базе без поля `scopes` — читаются
// как доступ только к базе знаний (то же самое делает бэкенд,
// services/mcp/keys.js#normalizeScopes).
const normalizeScopes = (scopes?: McpScope[] | null): McpScope[] =>
  scopes && scopes.length ? scopes : ["knowledge"];

const heldResources = (scopes?: McpScope[] | null) => {
  const given = normalizeScopes(scopes);
  return MCP_RESOURCES.map((resource) => ({
    resource,
    read: given.includes(resource.read),
    write: Boolean(resource.write && given.includes(resource.write)),
  })).filter(({ read, write }) => read || write);
};

/** Первая буква строчная; имя собственное «Mikrotik» остаётся с заглавной. */
export const lowerFirst = (text: string): string =>
  text.startsWith("Mikrotik") ? text : text.replace(/^./, (first) => first.toLowerCase());

/** «база знаний (чтение и запись), заявки и Mikrotik (чтение)» — доступ ключа словами. */
export const scopeAccessLabel = (scopes?: McpScope[] | null): string =>
  joinList(
    heldResources(scopes).map(({ resource, read, write }) => {
      const name = lowerFirst(resource.label);
      // У ресурса без записи уточнять нечего
      if (!resource.write) return name;
      return `${name} (${read && write ? "чтение и запись" : write ? "запись" : "чтение"})`;
    }),
  );

/** «к базе знаний, заявкам и Mikrotik» — что теряет агент при удалении ключа. */
export const scopeLossPhrase = (scopes?: McpScope[] | null): string =>
  `к ${joinList(heldResources(scopes).map(({ resource }) => resource.dative))}`;

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
      hint: "Агенты с доступом к базе знаний получают все проверенные заметки и черновики агентов: пароли и ключи в них никто не ищет. Поиск включается в разделе «База знаний».",
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
 * (`hd-helpdesk`, backend/services/mcp/server.js), но и заявки с Mikrotik.
 */
export const openClawConfig = (endpoint: string, value: string): string =>
  [
    "mcp: { servers: { helpdesk: {",
    `  url: ${JSON.stringify(endpoint)},`,
    '  transport: "streamable-http",',
    `  headers: { Authorization: ${JSON.stringify(`Bearer ${value}`)} },`,
    "} } }",
  ].join("\n");
