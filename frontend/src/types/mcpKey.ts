// Ключи ИИ-агентов к MCP (база знаний, заявки) — ответы
// `/api/preferences/mcp-keys` (backend/controllers/mcpKey.js). Значение ключа
// приходит один раз — в ответе на создание; в списке его нет, как и отпечатка.

/** Доступы ключа: база знаний и/или заявки (совпадает с backend MCP_SCOPES). */
export type McpScope = "knowledge" | "tickets";

export type McpKeyRow = {
  _id: string;
  name: string;
  keyTail: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: { _id: string; firstName?: string; lastName?: string } | null;
};

export type McpKeysResponse = {
  endpoint: string;
  keys: McpKeyRow[];
};

export type McpKeyCreated = {
  message: string;
  endpoint: string;
  key: McpKeyRow & { value: string };
};
