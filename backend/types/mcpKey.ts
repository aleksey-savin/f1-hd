import type { Types } from "mongoose";

/** Ключ ИИ-агента к базе знаний по MCP; значение не хранится, только отпечаток. */
export interface IMcpKey {
  name: string;
  keyHash: string;
  keyTail: string;
  createdBy?: Types.ObjectId;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
