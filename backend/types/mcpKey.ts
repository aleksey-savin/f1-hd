import type { Types } from "mongoose";

/** Ключ ИИ-агента к MCP (база знаний, заявки, Mikrotik); значение не хранится, только отпечаток. */
export interface IMcpKey {
  name: string;
  keyHash: string;
  keyTail: string;
  createdBy?: Types.ObjectId;
  lastUsedAt: Date | null;
  /** У ключей, выданных до появления доступов, поля нет — читаются как `["knowledge"]`. */
  scopes?: ("knowledge" | "tickets" | "companies" | "users" | "mikrotik" | "mikrotikChanges")[];
  createdAt: Date;
  updatedAt: Date;
}
